import { CodeActionFunctionParams } from '../../../utils/addon-api';
import { Command, CodeAction, WorkspaceEdit, CodeActionKind, TextEdit, Diagnostic } from 'vscode-languageserver/node';
import { toLSRange } from '../../../estree-utils';
import BaseCodeActionProvider, { INodeSelectionInfo } from './base';
import { TextDocument } from 'vscode-languageserver-textdocument';

export default class TemplateLintFixesCodeAction extends BaseCodeActionProvider {
  async fixTemplateLintIssues(issues: Diagnostic[], params: CodeActionFunctionParams, meta: INodeSelectionInfo): Promise<Array<CodeAction | null>> {
    if (!this.server.templateLinter.isEnabled) {
      return [];
    }

    const linterKlass = await this.server.templateLinter.linterForProject(this.project);

    if (!linterKlass) {
      return [null];
    }

    try {
      const fixes = issues.map(async (issue): Promise<null | CodeAction> => {
        const result = await this.server.templateLinter.fix(TextDocument.create(params.textDocument.uri, 'handlebars', 1, meta.selection || ''));

        if (result && result.isFixed) {
          const edit: WorkspaceEdit = {
            changes: {
              [params.textDocument.uri]: [TextEdit.replace(toLSRange(meta.location), result.output)],
            },
          };

          return CodeAction.create(`fix: ${issue.code}`, edit, CodeActionKind.QuickFix);
        } else {
          return null;
        }
      });
      const resolvedFixes = await Promise.all(fixes);

      return resolvedFixes;
    } catch (e) {
      return [];
    }
  }
  public async onCodeAction(_: string, params: CodeActionFunctionParams): Promise<(Command | CodeAction)[] | undefined | null> {
    const diagnostics = params.context.diagnostics as Diagnostic[];
    const fixableIssues = diagnostics.filter((el) => el.source === 'ember-template-lint' && el.message.endsWith('(fixable)'));

    if (fixableIssues.length === 0) {
      return null;
    }

    try {
      const meta = this.metaForRange(params);

      if (!meta) {
        return null;
      }

      const fixedIssues = await this.fixTemplateLintIssues(fixableIssues, params, meta);
      const codeActions = fixedIssues.filter((el) => el !== null) as CodeAction[];

      return codeActions;
    } catch (e) {
      return null;
    }
  }
}
