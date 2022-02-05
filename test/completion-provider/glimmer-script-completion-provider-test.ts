import { Server } from '../../src';
import GlimmerScriptCompletionProvider from '../../src/completion-provider/glimmer-script-completion-provider';
import { Position } from 'vscode-languageserver';

class ServerMock {
  constructor(private content: string) {}
  get documents() {
    return {
      get: () => {
        return {
          getText: () => {
            return this.content;
          },
        };
      },
    };
  }
}

function createServer(content: string) {
  return (new ServerMock(content) as unknown) as Server;
}

describe('GlimmerScriptCompletionProvider', function () {
  it('works', async function () {
    const tpl = `var n = 42; class Component { \n<template></template> }`;
    const provider = new GlimmerScriptCompletionProvider(createServer(tpl));
    const results = await provider.provideCompletions({
      textDocument: {
        uri: '',
      },
      position: Position.create(2, 12),
    });

    expect(results.length).toBe(1);
  });
});
