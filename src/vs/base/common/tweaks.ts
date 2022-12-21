/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/*
export const hiddenActivities = [
	'workbench.view.scm',
	'workbench.view.debug',
	'workbench.view.extensions',
	'workbench.action.terminal.toggleTerminal',
	'terminal',
	'workbench.action.files.openFile',
	'workbench.action.files.openFolder',
	'addRootFolder',
	'workbench.action.closeFolder',
	'workbench.action.files.saveAs',
	'workbench.action.saveWorkspaceAs',
	'workbench.action.duplicateWorkspaceInNewWindow',
	'menubar.submenu.Run',
	'menubar.submenu.Terminal',
	'workbench.action.openWorkspace',
	'openRecentWorkspace',
	'workbench.action.files.newUntitledFile',
	'welcome.showNewFileEntries'];
*/
export const hiddenActivities = window.localStorage.getItem('improveHiddenActivities') ? JSON.parse(window.localStorage.getItem('improveHiddenActivities')!) : ['none'];
