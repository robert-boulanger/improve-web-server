# Developing OpenVSCode Server

This guide implies that you have a good understanding of [source code organization](https://github.com/microsoft/vscode/wiki/Source-Code-Organization) and [development flow](https://github.com/microsoft/vscode/wiki/How-to-Contribute) of Code-OSS.

## Source Code Organization

We add [server](https://github.com/gitpod-io/openvscode-server/tree/main/src/vs/server) layer glueing everything required to run the server including the [web workbench](https://github.com/gitpod-io/openvscode-server/tree/main/src/vs/server/browser/workbench/workbench.ts), the [remote server](https://github.com/gitpod-io/openvscode-server/tree/main/src/vs/server/node/server.ts) and the [remote CLI](https://github.com/gitpod-io/openvscode-server/tree/main/src/vs/server/node/cli.ts).

The server consist of 2 applications:

- The web workbench is an entry point to a browser application configuring various services
  like how to establish the connection with the backend, resolve remote resources, load webviews, and so on.
- The server is running on a remote machine that serves the web workbench and static resources for webviews, extensions, and so on, as well as provides access to the file system, terminals, extensions, and so on.

The workbench and the server are communicating via RPC calls over web socket connections. There are 2 kinds of connections that we support right now:

- the management connection provides access to the server RPC channels, like filesystem and terminals;
- the extension connection creates the remote extension host process per a browser window to run extensions.

For each window, the server installs the CLI socket server and injects a special env var pointing to the socket file into each terminal. It allows the remote CLI to send commands to a proper window, for instance, to open a file.

Note that the workbench can be also bundled independently to serve from some CDN services. The server can run in headless mode if sources of the web workbench are missing.

## Building

### Starting from sources

- [Start a Gitpod workspace](https://gitpod.io/#https://github.com/gitpod-io/openvscode-server)
- Dev version of the server should be already up and running. Notice that the dev version is slower to load since it is not bundled (around 2000 files).

### Bundling

Run `yarn gulp vscode-reh-web-linux-x64-min` or `yarn gulp vscode-reh-web-darwin-arm64` to create production-ready distributable from sources. After the build is finished, you will be able to find the `vscode-reh-web-linux-x64` folder next to the repository folder (one level up from where you executed the command). In this folder, under `bin/` you will find a `openvscode-server` script: your entrypoint to the OpenVSCode server.

#### Different platforms and CPU architectures

If you want to have distributables for more types of hardware and operating systems, your folder names and the main command for compiling will change. You can find all of the gulp bundling tasks [here](https://github.com/gitpod-io/openvscode-server/blob/main/build/gulpfile.js) and if you execute `yarn gulp --tasks | grep "vscode-reh-web"` you will get all of the different distribution targets available (the options here are also the corresponding commands for bundling, which you need to prefix with `yarn gulp` in the terminal).

### Updating VS Code

- Update your local VS Code, open the About dialog and remember the release commit and Node.js version.
- Fetch latest upstream changes and rebase the branch based on the local VS Code's commit. Drop all commits before `code web server initial commit`.
- Check that [.gitpod.Dockerfile](https://github.com/gitpod-io/openvscode-server/blob/main/.gitpod.Dockerfile) and [remote/.yarnrc](https://github.com/gitpod-io/openvscode-server/blob/main/remote/.yarnrc) has latest major Node.js version of local VS Code's Node.js version.
- Recompile everything: `git clean -dfx && yarn && yarn server:init`
- Run smoke tests: `yarn server:smoketest`.
- Start the dev server and play:
  - filesystem (open some project)
  - extension host process: check language smartness
  - extension management (installing/uninstalling)
  - install VIM extension to test web extensions
  - terminals
  - code cli should open files and manage extensions: `alias code='export VSCODE_DEV=1 && node out/server-cli.js'`
- Check server/browser logs for any warnings/errors about missing capabilities and fix them.
- Build the production server with all changes: `yarn gulp server-min`.
- Run it and play as with the dev server: `/workspace/server-pkg/server.sh`
- Open a PR with your changes and ask for help if needed. It should be against `gitpod-io/openvscode-server` repo and `main` branch!

# Releases

The Dockerfile used for creating releases is located in a separate repository in an effort to minimize clutter. Please consult: https://github.com/gitpod-io/openvscode-releases/

## Changes by scinteco:

### src/vs/workbench/browser/parts/activitybar/activitybarPart.ts

We remove items from the left sidebar, mostly Debug, SCM and extensions

- Line 50

  ```ts
  import { hiddenActivities } from "vs/scinteco/tweaks";
  ```

- Line 782

  ```ts
  if (hiddenActivities.indexOf(viewContainer.id) < 0)
  ```

- Line 1002

  ```ts
  const cont = JSON.parse(this.pinnedViewContainersValue);
  return cont.filter((item: IPinnedViewContainer) => {
  	return hiddenActivities.indexOf(item.id) < 0;
  });
  ```

### src/vs/base/browser/ui/menu/menu.ts

We remove items from the menu, mostly Run, the Terminal and everythin inside the File menu which would request access to the servers file structure

- Line 28

  ```ts
  import { hiddenActivities } from "vs/scinteco/tweaks";
  ```

- Line 515
  ```ts
  if (hiddenActivities.indexOf(this._action.id) >= 0) {
  	return;
  }
  ```

### src/vs/platform/quickinput/browser/commandsQuickAccess.ts

Removes everything from the global command palette which we do not need or want

- Line 25

  ```ts
  import { hiddenActivities } from "vs/scinteco/tweaks";
  ```

- Line 128
  ```ts
  if (hiddenActivities.indexOf(commandPick.commandId) >= 0) {
  	continue;
  }
  ```

### src/vs/scinteco/tweaks.ts

Configure here all commands in vscode we do not need for improve

```ts
export const hiddenActivities = [
	"workbench.view.scm",
	"workbench.view.debug",
	"workbench.view.extensions",
	"workbench.action.terminal.toggleTerminal",
	"terminal",
	"workbench.action.files.openFile",
	"workbench.action.files.openFolder",
	"addRootFolder",
	"workbench.action.closeFolder",
	"workbench.action.files.saveAs",
	"workbench.action.saveWorkspaceAs",
	"workbench.action.duplicateWorkspaceInNewWindow",
	"menubar.submenu.Run",
	"menubar.submenu.Terminal",
	"workbench.action.openWorkspace",
	"openRecentWorkspace",
	"workbench.action.files.newUntitledFile",
	"welcome.showNewFileEntries",
];
```

### src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts

This changes only the text in the welcome page

- Line 755
  ```ts
  $(
  	"p.subtitle.description",
  	{},
  	localize(
  		{
  			key: "gettingStarted.editingEvolved",
  			comment: ["Shown as subtitle on the Welcome page."],
  		},
  		"Manage, trace and control all your data"
  	)
  );
  ```

### src/vs/workbench/contrib/preferences/browser/settingsEditor2.ts

We remove any chance for the user to change the global settings server side, which would allow th change the behaviour for all users. This can only be done by an admin who has access to the server side settings.json.
The only twaek here is to set enable remote settings to false

- Line 612
  ```ts
  this.settingsTargetsWidget = this._register(
  	this.instantiationService.createInstance(
  		SettingsTargetsWidget,
  		targetWidgetContainer,
  		{ enableRemoteSettings: false }
  	)
  );
  ```

### src/vs/workbench/contrib/files/browser/views/explorerView.ts

- setContextKeys

  ```ts
  private setContextKeys(stat: ExplorerItem | null | undefined): void {
  	if (stat instanceof ExplorerItem && stat.resource.scheme === 'improve') {
  		this.commandService.executeCommand('improve.resourceSelect', stat?.resource);
  	}
  	const folders = this.contextService.getWorkspace().folders;
  	const resource = stat ? stat.resource : folders[folders.length - 1].uri;
  	stat = stat || this.explorerService.findClosest(resource);
  	this.resourceContext.set(resource);
  	this.folderContext.set(!!stat && stat.isDirectory);
  	this.readonlyContext.set(!!stat && stat.isReadonly);
  	this.rootContext.set(!!stat && stat.isRoot);

  	if (resource) {
  		const overrides = resource ? this.editorResolverService.getEditors(resource).map(editor => editor.id) : [];
  		this.availableEditorIdsContext.set(overrides.join(','));
  	} else {
  		this.availableEditorIdsContext.reset();
  	}
  }
  ```

- Set ContextMenus

  The next one is important. WAIT for the execution of the command, and then build the context menu
  to be sure the context is set by the plugin and

  ```ts
  private async onContextMenu(e: ITreeContextMenuEvent<ExplorerItem>): Promise<void> {
  		const stat = e.element;
  		let anchor = e.anchor;

  		// Compressed folders
  		if (stat) {
  			const controller = this.renderer.getCompressedNavigationController(stat);

  			if (controller) {
  				if (e.browserEvent instanceof KeyboardEvent || isCompressedFolderName(e.browserEvent.target)) {
  					anchor = controller.labels[controller.index];
  				} else {
  					controller.last();
  				}
  			}
  		}

  		// update dynamic contexts
  		this.fileCopiedContextKey.set(await this.clipboardService.hasResources());
  		this.setContextKeys(stat);

  		const selection = this.tree.getSelection();

  		const roots = this.explorerService.roots; // If the click is outside of the elements pass the root resource if there is only one root. If there are multiple roots pass empty object.
  		let arg: URI | {};
  		if (stat instanceof ExplorerItem) {
  			const compressedController = this.renderer.getCompressedNavigationController(stat);
  			arg = compressedController ? compressedController.current.resource : stat.resource;
  		} else {
  			arg = roots.length === 1 ? roots[0].resource : {};
  		}

  		const showMenu = (): void => {
  			this.contextMenuService.showContextMenu({
  				menuId: MenuId.ExplorerContext,
  				menuActionOptions: { arg, shouldForwardArgs: true },
  				contextKeyService: this.tree.contextKeyService,
  				getAnchor: () => anchor,
  				onHide: (wasCancelled?: boolean) => {
  					if (wasCancelled) {
  						this.tree.domFocus();
  					}
  				},
  				getActionsContext: () => stat && selection && selection.indexOf(stat) >= 0
  					? selection.map((fs: ExplorerItem) => fs.resource)
  					: stat instanceof ExplorerItem ? [stat.resource] : []
  			});
  		};
  		if (stat instanceof ExplorerItem && stat.resource.scheme === 'improve') {
  			this.commandService.executeCommand('improve.resourceSelect', stat?.resource).then(() => {
  				showMenu();
  			});
  		}
  		else {
  			showMenu();
  		}
  	}
  ```

### src/vs/workbench/contrib/welcomeGettingStarted/common/gettingStartedContent.ts
