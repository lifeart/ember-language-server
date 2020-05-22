import { AddonAPI, CodeActionFunctionParams } from '../../utils/addon-api';
import { Command, CodeAction, WorkspaceEdit, CodeActionKind, TextEdit } from 'vscode-languageserver';
import Server from '../../server';
import { Project } from '../../project-roots';

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
    const diagnostics = params.context.diagnostics;
    const fixableIssues = diagnostics.filter((el) => el.source === 'ember-template-lint' && el.message.endsWith('(fixable)'));
    if (!fixableIssues) {
      return null;
    }
    const linter = await this.server.templateLinter.linterForProject(this.project);
    if (!linter) {
      return null;
    }
    const codeActions = fixableIssues.map((issue) => {
      const codePart = params.document.getText(issue.range);
      console.log('codePart', codePart);
      const { code } = linter.verifyAndFix(codePart);
      const edit: WorkspaceEdit = {
        changes: {
          [params.textDocument.uri]: [TextEdit.replace(issue.range, code)]
        }
      };
      return CodeAction.create('Fix ' + issue.code, edit, CodeActionKind.QuickFix);
    });
    return codeActions;
  }
}
