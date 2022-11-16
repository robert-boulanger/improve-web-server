/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ITerminalCapabilityStore, ITerminalCommand, TerminalCapability } from 'vs/platform/terminal/common/capabilities/capabilities';
import * as dom from 'vs/base/browser/dom';
import { IAction } from 'vs/base/common/actions';
import { asArray } from 'vs/base/common/arrays';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { AudioCue, IAudioCueService } from 'vs/workbench/contrib/audioCues/browser/audioCueService';
import { ITerminalQuickFixOpenerAction, ITerminalQuickFixOptions, TerminalQuickFixAction, TerminalQuickFixMatchResult } from 'vs/workbench/contrib/terminal/browser/terminal';
import { DecorationSelector, updateLayout } from 'vs/workbench/contrib/terminal/browser/xterm/decorationStyles';
import { IDecoration, Terminal } from 'xterm';
// Importing types is safe in any layer
// eslint-disable-next-line local/code-import-patterns
import type { ITerminalAddon } from 'xterm-headless';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ILogService } from 'vs/platform/log/common/log';
import { ITerminalContributionService } from 'vs/workbench/contrib/terminal/common/terminalExtensionPoints';
import { IExtensionTerminalQuickFix } from 'vs/platform/terminal/common/terminal';
import { URI } from 'vs/base/common/uri';
import { gitCreatePr, gitPushSetUpstream, gitSimilar } from 'vs/workbench/contrib/terminal/browser/terminalQuickFixBuiltinActions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IActionWidgetService, previewSelectedActionCommand } from 'vs/platform/actionWidget/browser/actionWidget';
import { ActionSet } from 'vs/platform/actionWidget/common/actionWidget';
import { TerminalQuickFix, toMenuItems } from 'vs/workbench/contrib/terminal/browser/widgets/terminalQuickFixMenuItems';

const quickFixTelemetryTitle = 'terminal/quick-fix';
type QuickFixResultTelemetryEvent = {
	quickFixId: string;
	fixesShown: boolean;
	ranQuickFixCommand?: boolean;
};
type QuickFixClassification = {
	owner: 'meganrogge';
	quickFixId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The quick fix ID' };
	fixesShown: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the fixes were shown by the user' };
	ranQuickFixCommand?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'If the command that was executed matched a quick fix suggested one. Undefined if no command is expected.' };
	comment: 'Terminal quick fixes';
};
const quickFixSelectors = [DecorationSelector.QuickFix, DecorationSelector.LightBulb, DecorationSelector.Codicon, DecorationSelector.CommandDecoration, DecorationSelector.XtermDecoration];
export interface ITerminalQuickFix {
	showMenu(): void;
	/**
	 * Registers a listener on onCommandFinished scoped to a particular command or regular
	 * expression and provides a callback to be executed for commands that match.
	 */
	registerCommandFinishedListener(options: ITerminalQuickFixOptions): void;
}

export interface ITerminalQuickFixAddon extends ITerminalQuickFix {
	onDidRequestRerunCommand: Event<{ command: string; addNewLine?: boolean }>;
}

export class TerminalQuickFixAddon extends Disposable implements ITerminalAddon, ITerminalQuickFixAddon {
	private readonly _onDidRequestRerunCommand = new Emitter<{ command: string; addNewLine?: boolean }>();
	readonly onDidRequestRerunCommand = this._onDidRequestRerunCommand.event;

	private _terminal: Terminal | undefined;

	private _commandListeners: Map<string, ITerminalQuickFixOptions[]> = new Map();

	private _quickFixes: IAction[] | undefined;

	private _decoration: IDecoration | undefined;

	private _fixesShown: boolean = false;
	private _expectedCommands: string[] | undefined;
	private _fixId: string | undefined;

	constructor(private readonly _capabilities: ITerminalCapabilityStore,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ITerminalContributionService private readonly _terminalContributionService: ITerminalContributionService,
		@IAudioCueService private readonly _audioCueService: IAudioCueService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ILogService private readonly _logService: ILogService,
		@ICommandService private readonly _commandService: ICommandService,
		@IActionWidgetService private readonly _actionWidgetService: IActionWidgetService
	) {
		super();
		const commandDetectionCapability = this._capabilities.get(TerminalCapability.CommandDetection);
		if (commandDetectionCapability) {
			this._registerCommandHandlers();
		} else {
			this._capabilities.onDidAddCapability(c => {
				if (c === TerminalCapability.CommandDetection) {
					this._registerCommandHandlers();
				}
			});
		}
		for (const quickFix of this._terminalContributionService.quickFixes) {
			this.registerCommandFinishedListener(convertToQuickFixOptions(quickFix));
		}
		this.registerCommandFinishedListener(gitSimilar());
		this.registerCommandFinishedListener(convertToQuickFixOptions(gitCreatePr()));
		this.registerCommandFinishedListener(convertToQuickFixOptions(gitPushSetUpstream()));
	}

	activate(terminal: Terminal): void {
		this._terminal = terminal;
	}

	showMenu(): void {
		this._fixesShown = true;
		this._decoration?.element?.click();
	}

	registerCommandFinishedListener(options: ITerminalQuickFixOptions): void {
		const matcherKey = options.commandLineMatcher.toString();
		const currentOptions = this._commandListeners.get(matcherKey) || [];
		currentOptions.push(options);
		this._commandListeners.set(matcherKey, currentOptions);
	}

	private _registerCommandHandlers(): void {
		const terminal = this._terminal;
		const commandDetection = this._capabilities.get(TerminalCapability.CommandDetection);
		if (!terminal || !commandDetection) {
			return;
		}
		this._register(commandDetection.onCommandFinished(command => {
			if (this._expectedCommands) {
				const quickFixId = this._fixId || '';
				const ranQuickFixCommand = this._expectedCommands.includes(command.command);
				this._logService.debug(quickFixTelemetryTitle, {
					quickFixId,
					fixesShown: this._fixesShown,
					ranQuickFixCommand
				});
				this._telemetryService?.publicLog2<QuickFixResultTelemetryEvent, QuickFixClassification>(quickFixTelemetryTitle, {
					quickFixId,
					fixesShown: this._fixesShown,
					ranQuickFixCommand
				});
				this._expectedCommands = undefined;
				this._fixId = undefined;
			}
			this._resolveQuickFixes(command);
			this._fixesShown = false;
		}));

		// The buffer is not ready by the time command finish
		// is called. Add the decoration on command start if there are corresponding quick fixes
		this._register(commandDetection.onCommandStarted(() => {
			this._registerQuickFixDecoration();
			this._quickFixes = undefined;
		}));
	}

	/**
	 * Resolves quick fixes, if any, based on the
	 * @param command & its output
	 */
	private _resolveQuickFixes(command: ITerminalCommand): void {
		if (command.command !== '') {
			this._disposeQuickFix();
		}
		const result = getQuickFixesForCommand(command, this._commandListeners, this._openerService, this._onDidRequestRerunCommand);
		if (!result) {
			return;
		}
		const { fixes, onDidRunQuickFix, expectedCommands } = result;
		this._expectedCommands = expectedCommands;
		this._fixId = fixes.map(f => f.id).join('');
		this._quickFixes = fixes;
		this._register(onDidRunQuickFix((quickFixId) => {
			const ranQuickFixCommand = (this._expectedCommands?.includes(command.command) || false);
			this._logService.debug(quickFixTelemetryTitle, {
				quickFixId,
				fixesShown: this._fixesShown,
				ranQuickFixCommand
			});
			this._telemetryService?.publicLog2<QuickFixResultTelemetryEvent, QuickFixClassification>(quickFixTelemetryTitle, {
				quickFixId,
				fixesShown: this._fixesShown,
				ranQuickFixCommand
			});
			this._disposeQuickFix();
			this._fixesShown = false;
		}));
	}

	private _disposeQuickFix(): void {
		this._decoration?.dispose();
		this._decoration = undefined;
		this._quickFixes = undefined;
	}

	/**
	 * Registers a decoration with the quick fixes
	 */
	private _registerQuickFixDecoration(): void {
		if (!this._terminal) {
			return;
		}
		if (!this._quickFixes) {
			return;
		}
		const marker = this._terminal.registerMarker();
		if (!marker) {
			return;
		}
		const decoration = this._terminal.registerDecoration({ marker, layer: 'top' });
		if (!decoration) {
			return;
		}
		this._decoration = decoration;
		const fixes = this._quickFixes;
		if (!fixes) {
			decoration.dispose();
			return;
		}
		decoration?.onRender((e: HTMLElement) => {
			if (e.classList.contains(DecorationSelector.QuickFix)) {
				return;
			}
			e.classList.add(...quickFixSelectors);
			updateLayout(this._configurationService, e);
			this._audioCueService.playAudioCue(AudioCue.terminalQuickFix);
			this._register(dom.addDisposableListener(e, dom.EventType.CLICK, () => {
				const rect = e.getBoundingClientRect();
				const anchor = {
					x: rect.x,
					y: rect.y,
					width: rect.width,
					height: rect.height
				};
				// TODO: What's documentation do? Need a vscode command?
				const documentation = fixes.map(f => { return { id: f.id, title: f.label, tooltip: f.tooltip }; });
				const actions = fixes.map(f => new TerminalQuickFix(f, f.label));
				const actionSet = {
					// TODO: Documentation and actions are separate?
					documentation,
					allActions: actions,
					hasAutoFix: false,
					validActions: actions,
					dispose: () => { }
				} as ActionSet<TerminalQuickFix>;

				const parentElement = e.parentElement?.parentElement?.parentElement?.parentElement;
				if (!parentElement) {
					return;
				}
				const delegate = {
					onSelect: async (fix: TerminalQuickFix, preview?: boolean) => {
						if (preview) {
							this._commandService.executeCommand(previewSelectedActionCommand);
						} else {
							fix.action?.run();
							this._actionWidgetService.hide();
						}
					},
					onHide: () => {
						this._terminal?.focus();
					},
				};
				this._actionWidgetService.show('quickFixWidget', toMenuItems, delegate, actionSet, anchor, parentElement,
					{
						showHeaders: true,
						includeDisabledActions: false,
						fromLightbulb: true
					});
			}));
		});
	}
}

export function getQuickFixesForCommand(
	command: ITerminalCommand,
	quickFixOptions: Map<string, ITerminalQuickFixOptions[]>,
	openerService: IOpenerService,
	onDidRequestRerunCommand?: Emitter<{ command: string; addNewLine?: boolean }>
): { fixes: IAction[]; onDidRunQuickFix: Event<string>; expectedCommands?: string[] } | undefined {
	const onDidRunQuickFixEmitter = new Emitter<string>();
	const onDidRunQuickFix = onDidRunQuickFixEmitter.event;
	const fixes: IAction[] = [];
	const newCommand = command.command;
	const expectedCommands = [];
	for (const options of quickFixOptions.values()) {
		for (const option of options) {
			if (option.exitStatus !== undefined && option.exitStatus !== (command.exitCode === 0)) {
				continue;
			}
			const commandLineMatch = newCommand.match(option.commandLineMatcher);
			if (!commandLineMatch) {
				continue;
			}
			const outputMatcher = option.outputMatcher;
			let outputMatch;
			if (outputMatcher) {
				outputMatch = command.getOutputMatch(outputMatcher);
			}
			const id = option.id;
			const quickFixes = option.getQuickFixes({ commandLineMatch, outputMatch }, command);
			if (quickFixes) {
				for (const quickFix of asArray(quickFixes)) {
					let action: IAction | undefined;
					if ('type' in quickFix) {
						switch (quickFix.type) {
							case 'command': {
								const label = localize('quickFix.command', 'Run: {0}', quickFix.command);
								action = {
									id: quickFix.id,
									label,
									class: undefined,
									enabled: true,
									run: () => {
										onDidRequestRerunCommand?.fire({
											command: quickFix.command,
											addNewLine: quickFix.addNewLine
										});
									},
									tooltip: label,
									command: quickFix.command
								} as IAction;
								expectedCommands.push(quickFix.command);
								break;
							}
							case 'opener': {
								const label = localize('quickFix.opener', 'Open: {0}', quickFix.uri.toString());
								action = {
									id: `quickFix.opener`,
									label,
									class: undefined,
									enabled: true,
									run: () => {
										openerService.open(quickFix.uri);
										// since no command gets run here, need to
										// clear the decoration and quick fix
										onDidRunQuickFixEmitter.fire(id);
									},
									tooltip: label,
									uri: quickFix.uri
								} as IAction;
								break;
							}
						}
					} else {
						action = {
							id: quickFix.id,
							label: quickFix.label,
							class: quickFix.class,
							enabled: quickFix.enabled,
							run: () => {
								quickFix.run();
								onDidRunQuickFixEmitter.fire(id);
							},
							tooltip: quickFix.tooltip
						};
					}
					if (action) {
						fixes.push(action);
					}
				}
			}
		}
	}
	return fixes.length > 0 ? { fixes, onDidRunQuickFix, expectedCommands } : undefined;
}

export function convertToQuickFixOptions(quickFix: IExtensionTerminalQuickFix): ITerminalQuickFixOptions {
	const type = quickFix.commandToRun ? 'command' : quickFix.linkToOpen ? 'opener' : undefined;
	const options = {
		id: quickFix.id,
		commandLineMatcher: quickFix.commandLineMatcher,
		outputMatcher: quickFix.outputMatcher,
		type,
		getQuickFixes: type === 'command' ? (matchResult: TerminalQuickFixMatchResult) => {
			const matches = matchResult.outputMatch;
			const commandToRun = quickFix.commandToRun;
			if (!matches || !commandToRun) {
				return;
			}
			const groups = matches.groups;
			if (!groups) {
				return;
			}
			const actions: TerminalQuickFixAction[] = [];
			let fixedCommand = commandToRun;
			for (const [key, value] of Object.entries(groups)) {
				const varToResolve = '${group:' + `${key}` + '}';
				if (!commandToRun.includes(varToResolve)) {
					return [];
				}
				fixedCommand = fixedCommand.replaceAll(varToResolve, value);
			}
			if (fixedCommand) {
				actions.push({
					type: 'command',
					id: quickFix.id,
					command: fixedCommand,
					addNewLine: true
				});
				return actions;
			}
			return;
		} : (matchResult: TerminalQuickFixMatchResult) => {
			const matches = matchResult.outputMatch;
			const linkToOpen = quickFix.linkToOpen;
			if (!matches || !linkToOpen) {
				return;
			}
			const groups = matches.groups;
			if (!groups) {
				return;
			}
			let link = linkToOpen;
			for (const [key, value] of Object.entries(groups)) {
				const varToResolve = '${group:' + `${key}` + '}';
				if (!linkToOpen?.includes(varToResolve)) {
					return [];
				}
				link = link.replaceAll(varToResolve, value);
			}
			return link ? { type: 'opener', uri: URI.parse(link) } as ITerminalQuickFixOpenerAction : [];
		},
		exitStatus: quickFix.exitStatus,
		source: quickFix.extensionIdentifier
	};
	return options;
}
