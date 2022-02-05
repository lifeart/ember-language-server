import { getTemplateLocals, preprocess, ASTv1 } from '@glimmer/syntax';
import { Range as LSRange } from 'vscode-languageserver/node';

export class TemplateData {
  loc: LSRange;
  content: string;
  constructor(content: string, loc: LSRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }) {
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
  clone() {
    const fRange = new FileRange(this.start);

    this.characters.forEach((char) => {
      fRange.addColumn(char);
    });
    fRange.line = this.line;

    return fRange;
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
  get content() {
    return this.lines.map((l) => l.content).join('\n');
  }
  extractDocumentPart(includeBounds = false, openTag = '', closeTag = '') {
    const results: TemplateData[] = [];
    let state = STATE.CLOSE;

    let buffer: string[] = [];

    const params = {
      start: new TPosition(),
      end: new TPosition(),
    };

    const openTemplate = (line: FileRange, offset: number) => {
      params.start = new TPosition(line.line, offset);
    };

    const completeTemplate = (line: FileRange, offset: number) => {
      params.end = new TPosition(line.line, offset);
      results.push(
        new TemplateData(buffer.join(''), {
          start: params.start,
          end: params.end,
        })
      );
      buffer = [];
    };

    this.lines.forEach((fileRange) => {
      let line = fileRange.content;
      let offset = 0;

      if (state === STATE.OPEN) {
        buffer.push('\n');
      }

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
            // buffer.push('\n');

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
  subtract(parts: TemplateData[]): RangeWalker {
    const ranges = this.lines.map((e) => e.clone());

    ranges.forEach((rangeLine) => {
      const lineNumber = rangeLine.line;
      const filteredParts = parts.filter((p) => p.loc.start.line <= lineNumber && p.loc.end.line >= lineNumber);

      filteredParts.forEach((part) => {
        const charPlaceholder = ' ';

        if (part.loc.start.line !== lineNumber && part.loc.end.line !== lineNumber) {
          // replace in-range characters with blank lines (dont have better idea for now)
          rangeLine.characters = rangeLine.characters.map(() => charPlaceholder);
        } else if (part.loc.start.line === lineNumber && part.loc.end.line === lineNumber) {
          rangeLine.characters = rangeLine.characters.map((char, index) => {
            if (index >= part.loc.start.character && index < part.loc.end.character) {
              return charPlaceholder;
            } else {
              return char;
            }
          });
        } else if (part.loc.start.line === lineNumber) {
          rangeLine.characters = rangeLine.characters.map((char, index) => {
            if (index >= part.loc.start.character) {
              return charPlaceholder;
            } else {
              return char;
            }
          });
        } else if (part.loc.end.line === lineNumber) {
          rangeLine.characters = rangeLine.characters.map((char, index) => {
            if (index < part.loc.end.character) {
              return charPlaceholder;
            } else {
              return char;
            }
          });
        } else {
          // Oops
        }
      });
    });

    return new RangeWalker(ranges);
  }
  templates(includeBounds = false) {
    return this.extractDocumentPart(includeBounds, '<template>', '</template>');
  }
  htmlComments(includeBounds = false) {
    return this.extractDocumentPart(includeBounds, '<!--', '-->');
  }
  hbsComments(includeBounds = false) {
    return this.extractDocumentPart(includeBounds, '{{!--', '--}}');
  }
  hbsInlineComments(includeBounds = false) {
    return this.extractDocumentPart(includeBounds, '{{!', '}}');
  }
  styles(includeBounds = false) {
    return this.extractDocumentPart(includeBounds, '<style>', '</style>');
  }
}
