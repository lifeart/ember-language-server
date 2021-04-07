import { normalizeToFs } from './integration-helpers';

describe('normalizeToFs', () => {
  it('support existing cases', () => {
    const files = {
      foo: {
        bar: {
          'baz.js': '1',
        },
      },
    };

    expect(normalizeToFs(files)).toStrictEqual(JSON.parse(JSON.stringify(files)));
  });
  it('support new case', () => {
    const expectedObj = {
      foo: {
        bar: {
          'baz.js': '1',
        },
      },
    };
    const files = {
      'foo/bar/baz.js': '1',
    };

    expect(normalizeToFs(files)).toStrictEqual(expectedObj);
  });
  it('support partial case', () => {
    const expectedObj = {
      foo: {
        bar: {
          'baz.js': '1',
        },
      },
    };
    const files = {
      foo: {
        'bar/baz.js': '1',
      },
    };

    expect(normalizeToFs(files)).toStrictEqual(expectedObj);
  });
});
