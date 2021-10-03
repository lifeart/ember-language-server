// async implementation of https://github.com/joliss/node-walk-sync/blob/master/index.ts

'use strict';

import * as MatcherCollection from 'matcher-collection';
import ensurePosix = require('ensure-posix-path');
import path = require('path');
import { IMinimatch, IOptions as MinimatchOptions, Minimatch } from 'minimatch';
import FSProvider from '../fs-provider';
import { flatten } from 'lodash';

async function walkAsync(baseDir: string, inputOptions?: walkAsync.Options | (string | IMinimatch)[]) {
  const options = handleOptions(inputOptions);

  let mapFunct: (arg: walkAsync.Entry) => string;

  if (options.includeBasePath) {
    mapFunct = function (entry: walkAsync.Entry) {
      return entry.basePath.split(path.sep).join('/').replace(/\/+$/, '') + '/' + entry.relativePath;
    };
  } else {
    mapFunct = function (entry: walkAsync.Entry) {
      return entry.relativePath;
    };
  }

  const data = await _walkAsync(baseDir, options, null, []);

  return data.map(mapFunct);
}
export = walkAsync;

async function getStat(path: string, fs: walkAsync.Options['fs']) {
  try {
    const data = await fs.stat(path);

    return data;
  } catch (error) {
    if (error !== null && typeof error === 'object' && (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EPERM')) {
      return;
    }

    throw error;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace walkAsync {
  export function entries(baseDir: string, inputOptions?: Options | (string | IMinimatch)[]) {
    const options = handleOptions(inputOptions);

    return _walkAsync(ensurePosix(baseDir), options, null, []);
  }

  export interface Options {
    includeBasePath?: boolean;
    globs?: (string | IMinimatch)[];
    ignore?: (string | IMinimatch)[];
    directories?: boolean;
    fs: FSProvider;
    globOptions?: MinimatchOptions;
  }

  export class Entry {
    relativePath: string;
    basePath: string;
    _isDirectory: boolean;

    constructor(relativePath: string, basePath: string, isDirectory: boolean) {
      this.relativePath = relativePath;
      this.basePath = basePath;
      this._isDirectory = isDirectory;
    }

    get fullPath() {
      return `${this.basePath}/${this.relativePath}`;
    }

    isDirectory() {
      return this._isDirectory;
    }
  }
}

function isDefined<T>(val: T | undefined): val is T {
  return typeof val !== 'undefined';
}

function handleOptions(_options?: walkAsync.Options | (string | IMinimatch)[]): walkAsync.Options {
  // @ts-expect-error empty options
  let options: walkAsync.Options = {};

  if (Array.isArray(_options)) {
    options.globs = _options;
  } else if (_options) {
    options = _options;
  }

  return options;
}

function applyGlobOptions(globs: (string | IMinimatch)[] | undefined, options: MinimatchOptions) {
  return globs?.map((glob) => {
    if (typeof glob === 'string') {
      return new Minimatch(glob, options);
    }

    return glob;
  });
}

function handleRelativePath(_relativePath: string | null) {
  if (_relativePath == null) {
    return '';
  } else if (_relativePath.slice(-1) !== '/') {
    return _relativePath + '/';
  } else {
    return _relativePath;
  }
}

function lexicographically(a: walkAsync.Entry, b: walkAsync.Entry) {
  const aPath = a.relativePath;
  const bPath = b.relativePath;

  if (aPath === bPath) {
    return 0;
  } else if (aPath < bPath) {
    return -1;
  } else {
    return 1;
  }
}

async function _walkAsync(baseDir: string, options: walkAsync.Options, _relativePath: string | null, visited: string[]): Promise<walkAsync.Entry[]> {
  const fs = options.fs;
  const relativePath = handleRelativePath(_relativePath);
  const realPath = path.join(baseDir, '/', relativePath);

  // fs.realpathSync(baseDir + '/' + relativePath);

  if (visited.indexOf(realPath) >= 0) {
    return [];
  } else {
    visited.push(realPath);
  }

  try {
    const globOptions = options.globOptions;
    const ignorePatterns = isDefined(globOptions) ? applyGlobOptions(options.ignore, globOptions) : options.ignore;
    const globs = isDefined(globOptions) ? applyGlobOptions(options.globs, globOptions) : options.globs;
    let globMatcher;
    let ignoreMatcher: undefined | InstanceType<typeof MatcherCollection>;

    if (ignorePatterns) {
      ignoreMatcher = new MatcherCollection(ignorePatterns);
    }

    if (globs) {
      globMatcher = new MatcherCollection(globs);
    }

    if (globMatcher && !globMatcher.mayContain(relativePath)) {
      return [];
    }

    const names = await fs.readDirectory(baseDir + '/' + relativePath);

    const rawEntries = names.map(async (name) => {
      const entryRelativePath = relativePath + name;

      if (ignoreMatcher && ignoreMatcher.match(entryRelativePath)) {
        return;
      }

      const fullPath = baseDir + '/' + entryRelativePath;
      const stats = await getStat(fullPath, fs);

      if (stats && stats.isDirectory()) {
        return new walkAsync.Entry(entryRelativePath + '/', baseDir, true);
      } else {
        return new walkAsync.Entry(entryRelativePath, baseDir, false);
      }
    });

    const unfilteredEntries = await Promise.all(rawEntries);
    const entries = unfilteredEntries.filter(isDefined);
    const sortedEntries = entries.sort(lexicographically);

    const extras: Array<walkAsync.Entry | Promise<walkAsync.Entry[]>> = [];

    for (let i = 0; i < sortedEntries.length; ++i) {
      const entry = sortedEntries[i];

      if (entry.isDirectory()) {
        if (options.directories !== false && (!globMatcher || globMatcher.match(entry.relativePath))) {
          extras.push(entry);
        }

        extras.push(_walkAsync(baseDir, options, entry.relativePath, visited));
      } else {
        if (!globMatcher || globMatcher.match(entry.relativePath)) {
          extras.push(entry);
        }
      }
    }

    const results: Array<walkAsync.Entry | walkAsync.Entry[]> = await Promise.all(extras as any);

    return flatten(results);
  } finally {
    if (visited.indexOf(realPath)) {
      visited.splice(visited.indexOf(realPath), 1);
    }
  }
}
