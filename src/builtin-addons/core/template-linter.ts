import { AddonAPI, CodeActionFunctionParams } from '../../utils/addon-api';
import { Command, CodeAction, WorkspaceEdit, CodeActionKind, TextEdit } from 'vscode-languageserver';
import { uriToFilePath } from 'vscode-languageserver/lib/files';
import Server from '../../server';
import { Project } from '../../project-roots';
import { logInfo } from '../../utils/logger';

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
      return null;
    }
    const linterKlass = await this.server.templateLinter.linterForProject(this.project);
    if (!linterKlass) {
      return null;
    }
    const linter = new linterKlass();
    const codeActions = fixableIssues
      .map((issue) => {
        const codePart = params.document.getText(issue.range);
        const { output, isFixed } = linter.verifyAndFix({
          source: codePart,
          moduleId: uriToFilePath(params.textDocument.uri),
          filePath: uriToFilePath(params.textDocument.uri)
        });
        if (!isFixed) {
          return null;
        }
        const edit: WorkspaceEdit = {
          changes: {
            [params.textDocument.uri]: [TextEdit.replace(issue.range, output)]
          }
        };
        return CodeAction.create('Fix ' + issue.code, edit, CodeActionKind.QuickFix);
      })
      .filter((el) => el !== null);
    return codeActions as CodeAction[];
  }
}
