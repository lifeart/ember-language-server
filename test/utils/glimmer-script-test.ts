import { getFileRanges } from './../../src/utils/glimmer-script';

describe('glimmer-scripts', function () {
  describe('getFileRanges()', function () {
    it('support single line file', function () {
      const tpl = `<template></template>`;
      const results = getFileRanges(tpl);

      expect(results.length).toBe(1);
      expect(results[0].content).toBe('<template></template>');
      expect(results[0].start).toBe(0);
      expect(results[0].line).toBe(1);
      expect(results[0].columns).toBe(tpl.length);
    });
    it('support two line file', function () {
      const tpl = `<template>\n</template>`;
      const results = getFileRanges(tpl);

      expect(results.length).toBe(2);
      expect(results[0].content).toBe('<template>');
      expect(results[0].start).toBe(0);
      expect(results[0].line).toBe(1);
      expect(results[0].columns).toBe('<template>'.length);
      expect(results[1].content).toBe('</template>');
      expect(results[1].start).toBe('<template>'.length);
      expect(results[1].line).toBe(2);
      expect(results[1].columns).toBe('</template>'.length);
    });
    it('support empty line file', function () {
      const tpl = `<template>\n\n</template>`;
      const results = getFileRanges(tpl);

      expect(results.length).toBe(3);
      expect(results[0].content).toBe('<template>');
      expect(results[1].content).toBe('');
      expect(results[2].content).toBe('</template>');
      expect(results[2].start).toBe('<template>\n\n'.length);
      expect(results[2].line).toBe(3);
    });
  });
});
