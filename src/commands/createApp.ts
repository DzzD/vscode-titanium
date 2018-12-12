import * as fs from 'fs-extra';
import * as path from 'path';

import { commands, ProgressLocation, Uri, window } from 'vscode';
import { VSCodeCommands } from '../constants';
import { ExtensionContainer } from '../container';
import { inputBox, selectFromFileSystem, selectPlatforms, yesNoQuestion } from '../quickpicks';
import { createAppArguments, validateAppId } from '../utils';
import { checkLogin, UserCancellation } from './common';

export async function createApplication () {
	try {
		checkLogin();
		// ToDo: Store last dir created in and provide as default?
		let force;
		const name = await inputBox({ prompt: 'Enter your application name' });
		const appId = await inputBox({
			prompt: 'Enter your application ID',
			validateInput: currentAppId => {
				const isValid = validateAppId(currentAppId);
				if (!isValid) {
					return 'Invalid app id!';
				}
			}
		});
		const platforms = await selectPlatforms();
		const enableServices = await yesNoQuestion({ placeHolder: 'Enable services?' });
		const location: Uri[] = await selectFromFileSystem({ canSelectFolders: true });
		const workspaceDir = location[0].path;
		if (await fs.pathExists(path.join(workspaceDir, name))) {
			force = await yesNoQuestion({ placeHolder: 'That app already exists. Would you like to overwrite?' }, true);
		}

		const args = createAppArguments({
			appId,
			enableServices,
			force,
			workspaceDir,
			name,
			platforms
		});
		await ExtensionContainer.terminal.runCommandInBackground(args, { cancellable: false, location: ProgressLocation.Notification, title: 'Creating application' });
		// TODO: Once workspace support is figured out, add an "add to workspace command"
		const dialog = await window.showInformationMessage('Project created. Would you like to open it?', { modal: true }, { title: 'Open Project' });
		if (dialog) {
			const projectDir = Uri.parse(path.join(workspaceDir, name));
			await commands.executeCommand(VSCodeCommands.OpenFolder, projectDir, true);
		}
	} catch (error) {
		if (error instanceof UserCancellation) {
			//
		}
	}
}
