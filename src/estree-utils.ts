import { Position, SourceLocation } from 'estree';
import { Position as LSPosition, Range as LSRange } from 'vscode-languageserver/node';

export function newPosition(line: number, column: number): Position {
  return { line, column };
}

export function comparePositions(a: Position, b: Position): number {
  if (a.line < b.line) return -1;
  if (a.line > b.line) return 1;

  if (a.column < b.column) return -1;
  if (a.column > b.column) return 1;

  return 0;
}

export function toPosition(lsp: LSPosition): Position {
  return newPosition(lsp.line + 1, lsp.character);
}

export function toLSPosition(pos: Position): LSPosition {
  return LSPosition.create(pos.line - 1, pos.column);
}

export function toLSRange(loc: SourceLocation): LSRange {
  return LSRange.create(toLSPosition(loc.start), toLSPosition(loc.end));
}

export function newLocation(startLine: number, startColumn: number, endLine: number, endColumn: number): SourceLocation {
  const start = { line: startLine, column: startColumn };
  const end = { line: endLine, column: endColumn };

  return { start, end };
}

export function containsPosition(loc: SourceLocation, position: Position): boolean {
  return comparePositions(position, loc.start) >= 0 && comparePositions(position, loc.end) <= 0;
}
