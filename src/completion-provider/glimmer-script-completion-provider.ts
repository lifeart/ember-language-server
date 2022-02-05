import { CompletionItem, TextDocumentPositionParams } from 'vscode-languageserver/node';
import Server from '../server';
import { getFileRanges, RangeWalker, getPlaceholderPathFromAst, getScope } from '../utils/glimmer-script';
import { parseScriptFile as parse } from 'ember-meta-explorer';
import { containsPosition, toPosition } from '../estree-utils';

export default class GlimmerScriptCompletionProvider {
  constructor(private server: Server) {}
  async provideCompletions(params: TextDocumentPositionParams): Promise<CompletionItem[]> {
    const document = this.server.documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    const rawContent = document.getText();

    const ranges = getFileRanges(rawContent);

    let rangeWalker = new RangeWalker(ranges);

    // strip not needed scopes example
    rangeWalker = rangeWalker.subtract(rangeWalker.hbsInlineComments(true));
    rangeWalker = rangeWalker.subtract(rangeWalker.hbsComments(true));
    rangeWalker = rangeWalker.subtract(rangeWalker.htmlComments(true));

    const templates = rangeWalker.templates(true);

    const cleanScriptWalker = rangeWalker.subtract(templates, true);

    const templateForPosition = templates.find((el) => {
      return containsPosition(
        {
          start: {
            line: el.loc.start.line,
            column: el.loc.start.character,
          },
          end: {
            line: el.loc.end.line,
            column: el.loc.end.character,
          },
        },
        toPosition(params.position)
      );
    });

    const ast = parse(cleanScriptWalker.content, {
      sourceType: 'module',
    });

    if (templateForPosition) {
      const placeholder = getPlaceholderPathFromAst(ast, templateForPosition.key);

      if (!placeholder) {
        return [];
      }

      const scopes = getScope(placeholder.scope);

      return scopes.map((name) => {
        return {
          label: name,
        };
      });
      // do logic to get more meta from js scope for template position
      // here we need glimmer logic to collect all available tokens from scope for autocomplete
    } else {
      return [];
    }
  }
}
