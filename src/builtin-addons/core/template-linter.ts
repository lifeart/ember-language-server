import { AddonAPI, CodeActionFunctionParams } from '../../utils/addon-api';
import { Command, CodeAction, WorkspaceEdit, CodeActionKind, TextEdit } from 'vscode-languageserver';
import { uriToFilePath } from 'vscode-languageserver/lib/files';
import Server from '../../server';
import { Project } from '../../project-roots';
import { logInfo, logError } from '../../utils/logger';

export default class ProjectTemplateLinter implements AddonAPI {
  private server!: Server;
  private project!: Project;
  onInit(server: Server, project: Project) {
    this.server = server;
    this.project = project;
  }
  async onCodeAction(_: string, params: CodeActionFunctionParams): Promise<(Command | CodeAction)[] | undefined | null> {
    if (!params.textDocument.uri.endsWith('.hbs')) {
      return null;
    }
    logInfo('onCodeAction', 'template-linter');
    const diagnostics = params.context.diagnostics;
    logInfo(JSON.stringify(diagnostics));
    const fixableIssues = diagnostics.filter((el) => el.source === 'ember-template-lint' && el.message.endsWith('(fixable)'));
    if (!fixableIssues) {
      logInfo('no fixable issues found');
      return null;
    }
    const linterKlass = await this.server.templateLinter.linterForProject(this.project);
    if (!linterKlass) {
      logInfo('no linter class found');

      return null;
    }
    const linter = new linterKlass();
    let codeActions: CodeAction[] = [];
    try {
      codeActions = fixableIssues
        .map((issue) => {
          const codePart = params.document.getText(issue.range);
          logInfo(`${codePart} <- codePart`);
          const { output, isFixed } = linter.verifyAndFix({
            source: codePart,
            moduleId: uriToFilePath(params.textDocument.uri),
            filePath: uriToFilePath(params.textDocument.uri)
          });
          logInfo(`output -> ${output}, isFixed -> ${isFixed}`);

          // if (!isFixed) {
          //   return null;
          // }
          const edit: WorkspaceEdit = {
            changes: {
              [params.textDocument.uri]: [TextEdit.replace(issue.range, output + '[fixed]')]
            }
          };
          return CodeAction.create('Fix ' + issue.code, edit, CodeActionKind.QuickFix);
        })
        .filter((el) => el !== null) as CodeAction[];
    } catch (e) {
      logError(e);
    }

    return codeActions as CodeAction[];
  }
}
