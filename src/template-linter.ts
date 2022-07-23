import { Diagnostic, Files } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getExtension } from './utils/file-extension';
import { log, logError, logInfo } from './utils/logger';
import { Worker } from 'worker_threads';
import Server from './server';
import { Project } from './project';
import { getRequireSupport } from './utils/layout-helpers';
import { extensionsToLint, LinterMessage } from './linter-thread';
import * as path from 'path';

type FindUp = (name: string, opts: { cwd: string; type: string }) => Promise<string | undefined>;

type WorkerLintMessage = {
  id: string;
  error: null | string;
  diagnostics: Diagnostic[];
};

type WorkerFixMessage = {
  id: string;
  error: null | string;
  output: string;
  isFixed: boolean;
};

type WorkerMessage = WorkerFixMessage | WorkerLintMessage;

type FixOutput = { isFixed: boolean; output: string };

type QItem = {
  id: string;
  resolve: (value: PromiseLike<Diagnostic[]> | Diagnostic[] | FixOutput | PromiseLike<FixOutput>) => void;
  reject: (reason: string) => void;
  tId: number;
};

class WorkerWrapper {
  worker: Worker;
  queue: QItem[];
  constructor(worker: Worker) {
    this.worker = worker;
    this.queue = [];
    worker.on('message', (message: WorkerMessage) => {
      const q = this.queue.find((q) => q.id === message.id);

      logInfo(`Message for ${message.id}: ${JSON.stringify(message)}`);

      if (q) {
        this.queue = this.queue.filter((q) => q.id !== message.id);
        clearTimeout(q.tId);

        if (message.error !== null) {
          logInfo(message.error);
          q.reject(message.error);
        } else {
          if ('diagnostics' in message) {
            q.resolve(message.diagnostics);
          } else if ('output' in message) {
            q.resolve({ isFixed: message.isFixed, output: message.output });
          }
        }
      }
    });
    worker.on('error', (e) => {
      logError(e as Error & { stack: string });
    });
  }
  addToQueue(q: QItem, fn: () => LinterMessage) {
    if (this.queue.length < 100) {
      q.tId = setTimeout(() => {
        this.queue = this.queue.filter((q) => q !== q);
        logInfo(`Timeout for ${q.id}`);
      }, 10000) as unknown as number;
      this.queue.push(q);
      logInfo(`Adding to queue ${q.id}`);
      this.worker.postMessage(fn());
    }
  }
}

export default class TemplateLinter {
  private _linterCache = new Map<Project, string>();
  private _isEnabled = true;
  private _findUp: FindUp;
  private workers: WeakMap<Project, WorkerWrapper> = new WeakMap();
  private _qID = 0;

  constructor(private server: Server) {
    if (this.server.options.type === 'worker') {
      this.disable();
    }
  }

  initWorker(project: Project): WorkerWrapper | undefined {
    try {
      if (!this.workers.has(project)) {
        const worker = new Worker(path.join(__dirname, './linter-thread.js'), {
          workerData: {
            cwd: project.root,
          },
        });
        const wrapper = new WorkerWrapper(worker);

        this.workers.set(project, wrapper);
      }

      return this.workers.get(project);
    } catch (e) {
      logError(e);

      return undefined;
    }
  }

  disable() {
    this._isEnabled = false;
  }

  enable() {
    this._isEnabled = true;
  }

  get isEnabled() {
    return this._isEnabled;
  }

  qID() {
    this._qID++;

    return String(this._qID);
  }

  private getProjectForDocument(textDocument: TextDocument) {
    const ext = getExtension(textDocument);

    if (ext !== null && !extensionsToLint.includes(ext)) {
      return;
    }

    return this.server.projectRoots.projectForUri(textDocument.uri);
  }

  async fix(textDocument: TextDocument): Promise<{ isFixed: boolean; output: string } | undefined> {
    if (this._isEnabled === false) {
      return;
    }

    const project = this.getProjectForDocument(textDocument);

    if (!project) {
      return;
    }

    const linterPath = await this.getLinter(project);

    if (!linterPath) {
      return;
    }

    const wrapper = await this.initWorker(project);

    if (!wrapper) {
      return;
    }

    const p: Promise<FixOutput> = new Promise((resolve, reject) => {
      const id = this.qID();
      const ref = { id, resolve, reject, tId: -1 };

      wrapper.addToQueue(ref, () => {
        const msg: LinterMessage = {
          id,
          action: 'verifyAndFix',
          content: textDocument.getText(),
          uri: textDocument.uri,
          projectRoot: project.root,
          linterPath,
        };

        return msg;
      });
    });

    const { isFixed, output } = await p;

    return { isFixed, output: output ?? '' };
  }

  async lint(textDocument: TextDocument): Promise<Diagnostic[] | undefined> {
    if (this._isEnabled === false) {
      return;
    }

    const project = this.getProjectForDocument(textDocument);

    if (!project) {
      return;
    }

    const linterPath = await this.getLinter(project);

    if (!linterPath) {
      return;
    }

    const wrapper = await this.initWorker(project);

    if (!wrapper) {
      return;
    }

    const p: Promise<Diagnostic[]> = new Promise((resolve, reject) => {
      const id = this.qID();
      const ref = { id, resolve, reject, tId: -1 };

      wrapper.addToQueue(ref, () => {
        const msg: LinterMessage = {
          id,
          action: 'verify',
          content: textDocument.getText(),
          uri: textDocument.uri,
          projectRoot: project.root,
          linterPath,
        };

        return msg;
      });
    });

    try {
      const diagnostics: Diagnostic[] = await p;

      return diagnostics;
    } catch (e) {
      logInfo(e);

      return [];
    }
  }
  async getFindUp(): Promise<FindUp> {
    if (!this._findUp) {
      const { findUp } = await eval(`import('find-up')`);

      this._findUp = findUp;
    }

    return this._findUp;
  }
  private async templateLintConfig(cwd: string): Promise<string | undefined> {
    const findUp = await this.getFindUp();

    return findUp('.template-lintrc.js', { cwd, type: 'file' });
  }
  private async projectNodeModules(cwd: string): Promise<string | undefined> {
    const findUp = await this.getFindUp();

    return findUp('node_modules', { cwd, type: 'directory' });
  }
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  public async linterForProject(project: Project) {
    return await this.getLinter(project);
  }
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  private async getLinter(project: Project): Promise<string | undefined> {
    if (this._linterCache.has(project)) {
      return this._linterCache.get(project);
    }

    try {
      // don't resolve template-lint (due to resolution error) if no linter config found;
      if (!(await this.templateLintConfig(project.root))) {
        return;
      }

      if (!getRequireSupport()) {
        return;
      }

      const nodePath = await this.projectNodeModules(project.root);

      if (!nodePath || !(await this.server.fs.exists(nodePath))) {
        return;
      }

      const linterPath = await (Files.resolveModulePath(project.root, 'ember-template-lint', nodePath, () => {
        /* intentially empty default callback */
      }) as Promise<string>);

      if (!linterPath) {
        return;
      }

      this._linterCache.set(project, linterPath);

      return linterPath;
    } catch (error) {
      log('Module ember-template-lint not found. ' + error.toString());
    }
  }
}
