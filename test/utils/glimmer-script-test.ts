import { getFileRanges, RangeWalker } from './../../src/utils/glimmer-script';

function rw(tpl: string) {
  return new RangeWalker(getFileRanges(tpl));
}

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

  describe('RangeWalker', function () {
    describe('<template></template>', function () {
      describe('without bounds', function () {
        it('able to extract template content from single line file', function () {
          const tpl = `<template>42</template>`;
          const r = rw(tpl);
          const templates = r.templates();
          const [template] = templates;

          expect(templates.length).toBe(1);
          expect(template.content).toBe('42');
          expect(template.loc.start.line).toBe(1);
          expect(template.loc.start.character).toBe(10);
          expect(template.loc.end.line).toBe(1);
          expect(template.loc.end.character).toBe(12);
        });

        it('able to extract template content from multi line file', function () {
          const content = '\n4\n2\n';
          const tpl = `<template>${content}</template>`;
          const r = rw(tpl);
          const templates = r.templates();
          const [template] = templates;

          expect(templates.length).toBe(1);
          expect(template.content.split('\n')).toStrictEqual(content.split('\n'));
          expect(template.content).toEqual(content);
          expect(template.loc.start.line).toBe(1);
          expect(template.loc.start.character).toBe(10);
          expect(template.loc.end.line).toBe(4);
          expect(template.loc.end.character).toBe(0);
        });
      });

      describe('with bounds', function () {
        it('able to extract template content from single line file', function () {
          const tpl = `<template>42</template>`;
          const r = rw(tpl);
          const templates = r.templates(true);
          const [template] = templates;

          expect(templates.length).toBe(1);
          expect(template.content).toBe(tpl);
          expect(template.loc.start.line).toBe(1);
          expect(template.loc.start.character).toBe(0);
          expect(template.loc.end.line).toBe(1);
          expect(template.loc.end.character).toBe(tpl.length);
        });

        it('able to extract template content from multi line file', function () {
          const content = '\n4\n2\n';
          const tpl = `<template>${content}</template>`;
          const r = rw(tpl);
          const templates = r.templates(true);
          const [template] = templates;

          expect(templates.length).toBe(1);
          expect(template.content.split('\n')).toStrictEqual(tpl.split('\n'));
          expect(template.content).toEqual(tpl);
          expect(template.loc.start.line).toBe(1);
          expect(template.loc.start.character).toBe(0);
          expect(template.loc.end.line).toBe(4);
          expect(template.loc.end.character).toBe(11);
        });
      });
    });
  });
});
