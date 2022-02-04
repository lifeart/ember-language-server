/* eslint-disable @typescript-eslint/no-unused-vars */
import Server from './../server';
import ASTPath from './../glimmer-utils';
import { TextDocumentPositionParams, Definition, Location } from 'vscode-languageserver/node';
import { parseScriptFile as parse } from 'ember-meta-explorer';
import { containsPosition, toPosition } from './../estree-utils';
import { queryELSAddonsAPIChain } from './../utils/addon-api';
import { Project } from '../project';
import { getTemplateLocals, preprocess, ASTv1 } from '@glimmer/syntax';
import { Range as LSRange } from 'vscode-languageserver/node';

class TemplateData {
  loc: LSRange;
  content: string;
  constructor(loc: LSRange, content: string) {
    this.loc = loc;
    this.content = content;
  }
  get placeholder() {
    return `__GLIMMER_TEMPLATE__`;
  }
  get locals() {
    return getTemplateLocals(this.content);
  }
  get ast(): ASTv1.Template {
    return preprocess(this.content);
  }
}

class FileRange {
  start = 0;
  columns = 0;
  characters: string[] = [];
  constructor(start = 0) {
    this.start = start;
  }
  addColumn(character = '') {
    this.columns++;
    this.characters.push(character);
  }
  get line() {
    return this.characters.join('');
  }
}

export function getFileRanges(file = '') {
  const ranges = [new FileRange()];

  for (let i = 0; i < file.length; i++) {
    if (file.charAt(i) !== '\n') {
      ranges[ranges.length - 1].addColumn(file.charAt(i));
    } else {
      ranges.push(new FileRange(i));
    }
  }

  return ranges;
}

const TEMPLATE_START = '<template>'; // ['precompileTemplate(`', 'hbs`']
const TEMPLATE_END = '</template>';
// const HTML_COMMENT_START = '<!--';
// const HTML_COMMENT_END = '-->';
// const HBS_COMMENT_START = '{{!--';
// const HBS_COMMENT_END = '--}}';
// const HBS_COMMENT_INLINE_START = '{{! ';
// const HBS_COMMENT_INLINE_END = '}}';

const STATE = {
  OPEN: 0,
  HTML_COMMENT_OPEN: 2,
  HTML_COMMENT_CLOSE: 3,
  CLOSE: 1,
};

class TPosition {
  line = 0;
  character = 0;
  constructor(line = 0, character = 0) {
    this.line = line;
    this.character = character;
  }
}

export class RangeWalker {
  constructor(lines: FileRange[]) {
    this.lines = lines;
  }
  lines: FileRange[] = [];
  templates() {
    const results: TemplateData[] = [];
    let state = STATE.CLOSE;

    let buffer: string[] = [];

    const params = {
      start: new TPosition(),
      end: new TPosition(),
    };

    const openTemplate = (line: FileRange, offset: number) => {
      params.start = new TPosition(this.lines.indexOf(line), offset);
    };

    const completeTemplate = (line: FileRange, offset: number) => {
      params.end = new TPosition(this.lines.indexOf(line), offset);
      results.push(
        new TemplateData(
          {
            start: params.start,
            end: params.end,
          },
          buffer.join('')
        )
      );
      buffer = [];
    };

    this.lines.forEach((fileRange) => {
      let line = fileRange.line;
      let offset = 0;

      while (line.length) {
        if (state === STATE.CLOSE) {
          const index = line.indexOf(TEMPLATE_START);

          if (index === -1) {
            return;
          } else {
            offset = offset + index + TEMPLATE_START.length;
            line = line.slice(index + TEMPLATE_START.length);
            state = STATE.OPEN;
            openTemplate(fileRange, offset);
          }
        } else if (state === STATE.OPEN) {
          const index = line.indexOf(TEMPLATE_END);

          if (index === -1) {
            buffer.push(line);
            buffer.push('\n');

            return;
          } else {
            buffer.push(line.slice(0, index));
            line = line.slice(index + TEMPLATE_END.length);
            offset = offset + index;
            state = STATE.CLOSE;
            completeTemplate(fileRange, offset);
          }
        } else {
          // OOPS
        }
      }
    });

    return results;
  }
}

export default class GlimmerScriptDefinitionProvider {
  constructor(private server: Server) {}
  async handle(params: TextDocumentPositionParams, project: Project): Promise<Definition | null> {
    const uri = params.textDocument.uri;
    const { root } = project;
    const document = this.server.documents.get(uri);

    if (!document) {
      return null;
    }

    const content = document.getText();

    const ranges = getFileRanges(content);

    const rangeWalker = new RangeWalker(ranges);

    const templates = rangeWalker.templates();

    // __GLIMMER_TEMPLATE/*<template></template>*/
    console.log(templates);

    let script = content;

    templates.forEach((t) => {
      const start = ranges[t.loc.start.line].start + t.loc.start.character;
      const end = ranges[t.loc.end.line].start + t.loc.end.character;
      const newLines = new Array(t.loc.end.line - t.loc.start.line).fill('\n');
      const tail = new Array(t.loc.end.character).fill(' ');
      const tokens = t.locals.join(',');
      // keep original template size

      script = script.substring(0, start) + `${t.placeholder} = [${tokens}]${newLines}${tail}` + script.substring(end);
    });

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

    if (templateForPosition) {
      // do logic to get more meta from js scope for template position
    } else {
      // looks like we could "fix" template and continue in script branch;
    }
    // @to-do - figure out how to patch babel ast with hbs
    // or don't patch it, and just have 2 refs from hbs ast to scope of js ast

    const ast = parse(script, {
      sourceType: 'module',
    });

    const astPath = ASTPath.toPosition(ast, toPosition(params.position), content);

    if (!astPath) {
      return null;
    }

    const results: Location[] = await queryELSAddonsAPIChain(project.builtinProviders.definitionProviders, root, {
      focusPath: astPath,
      type: 'glimmerScript',
      textDocument: params.textDocument,
      position: params.position,
      results: [],
      server: this.server,
    });

    const addonResults = await queryELSAddonsAPIChain(project.providers.definitionProviders, root, {
      focusPath: astPath,
      type: 'glimmerScript',
      textDocument: params.textDocument,
      position: params.position,
      results,
      server: this.server,
    });

    return addonResults;
  }
}
