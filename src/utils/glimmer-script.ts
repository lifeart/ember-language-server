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
  line = 0;
  characters: string[] = [];
  constructor(start = 0) {
    this.start = start;
  }
  addColumn(character = '') {
    this.columns++;
    this.characters.push(character);
  }
  get content() {
    return this.characters.join('');
  }
}

export function getFileRanges(file = '') {
  const ranges = [new FileRange()];

  let newline = 0;

  for (let i = 0; i < file.length; i++) {
    if (file.charAt(i) !== '\n') {
      ranges[ranges.length - 1].addColumn(file.charAt(i));
    } else {
      ranges.push(new FileRange(i + newline));
      newline++;
    }
  }

  return ranges.map((e, index) => {
    e.line = index + 1;

    return e;
  });
}

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
  extractDocumentPart(includeBounds = false, openTag = '', closeTag = '') {
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
      let line = fileRange.content;
      let offset = 0;

      while (line.length) {
        if (state === STATE.CLOSE) {
          const index = line.indexOf(openTag);

          if (index === -1) {
            return;
          } else {
            if (!includeBounds) {
              offset = offset + index + openTag.length;
              line = line.slice(index + openTag.length);
            } else {
              offset = offset + index;
              line = line.slice(index);
            }

            state = STATE.OPEN;
            openTemplate(fileRange, offset);
          }
        } else if (state === STATE.OPEN) {
          const index = line.indexOf(closeTag);

          if (index === -1) {
            buffer.push(line);
            buffer.push('\n');

            return;
          } else {
            if (!includeBounds) {
              buffer.push(line.slice(0, index));
              line = line.slice(index + closeTag.length);
              offset = offset + index;
            } else {
              buffer.push(line.slice(0, index + closeTag.length));
              line = line.slice(index + closeTag.length);
              offset = offset + index + closeTag.length;
            }

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
  templates() {
    return this.extractDocumentPart(false, '<template>', '</template>');
  }
  htmlComments() {
    return this.extractDocumentPart(false, '<!--', '-->');
  }
  hbsComments() {
    return this.extractDocumentPart(false, '{{!--', '--}}');
  }
  hbsInlineComments() {
    return this.extractDocumentPart(false, '{{!', '}}');
  }
  styles() {
    return this.extractDocumentPart(false, '<style>', '</style>');
  }
}
