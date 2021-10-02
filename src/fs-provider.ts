import * as fs from 'fs';
import { Connection } from 'vscode-languageserver';
import { DocumentUri } from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';

let currentFSImplementation!: FSProvider;

export function setFSImplementation(fs: FSProvider) {
  currentFSImplementation = fs;
}

export function fsProvider(): FSProvider {
  if (!currentFSImplementation) {
    setFSImplementation(new FSProvider());
  }

  return currentFSImplementation;
}

export default class FSProvider {
  // expected VSCode api, replacement of existsSync
  async exists(uri: DocumentUri | fs.PathLike): Promise<boolean> {
    const entry = URI.isUri(uri) ? URI.parse(uri as DocumentUri).fsPath : uri;

    try {
      await fs.statSync(entry);

      return true;
    } catch (e) {
      return false;
    }
  }
  // expected VSCode api, replacement of readFileSync
  async readFile(uri: DocumentUri | fs.PathLike): Promise<string> {
    const entry = URI.isUri(uri) ? URI.parse(uri as DocumentUri).fsPath : uri;
    const item = fs.readFileSync(entry, null);

    return item.toString('utf8');
  }
  // logger api
  createWriteStream(filePath: fs.PathLike, flags: { flags: string }) {
    return fs.createWriteStream(filePath, flags);
  }
  // walk-sync api
  statSync(filePath: fs.PathLike) {
    return fs.statSync(filePath);
  }
  realpathSync(filePath: fs.PathLike, options?: { encoding?: BufferEncoding | null } | BufferEncoding | null) {
    return fs.realpathSync(filePath, options);
  }
  readdirSync(filePath: fs.PathLike, options?: BufferEncoding | { encoding: BufferEncoding | null; withFileTypes?: false | undefined } | null | undefined) {
    return fs.readdirSync(filePath, options);
  }
}

export class AsyncFsProvider extends FSProvider {
  connection!: Connection;
  constructor(connection: Connection) {
    super();
    this.connection = connection;
  }
  _getGetUri(uri: DocumentUri | fs.PathLike): URI {
    const entry = URI.isUri(uri) ? uri : URI.file(uri as string);

    return entry;
  }
  async readFile(uri: DocumentUri | fs.PathLike): Promise<string> {
    const entry = this._getGetUri(uri);
    const result = await this.connection.sendRequest('els.fs.readFile', [entry]);

    return result as string;
  }
  async exists(uri: DocumentUri | fs.PathLike): Promise<boolean> {
    const entry = this._getGetUri(uri);
    const result = await this.connection.sendRequest('els.fs.stat', [entry]);

    if (result === null) {
      return false;
    } else {
      return true;
    }
  }
}
