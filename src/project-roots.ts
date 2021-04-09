'use strict';

import * as path from 'path';
import { logError, logInfo } from './utils/logger';
import * as walkSync from 'walk-sync';
import { URI } from 'vscode-uri';
import * as fs from 'fs';
import { isGlimmerNativeProject, isGlimmerXProject, isELSAddonRoot, isRootStartingWithFilePath } from './utils/layout-helpers';

import Server from './server';

import { Project } from './project';

export default class ProjectRoots {
  constructor(private server: Server) {}
  workspaceRoot: string;

  projects = new Map<string, Project>();

  localAddons: string[] = [];
  ignoreRoots: string[] = [];

  reloadProjects() {
    Array.from(this.projects).forEach(([root]) => {
      this.reloadProject(root);
    });
  }

  reloadProject(projectRoot: string) {
    this.removeProject(projectRoot);
    this.onProjectAdd(projectRoot);
  }

  removeProject(projectRoot: string) {
    const project = this.projectForPath(projectRoot);

    if (project) {
      project.unload();
    }

    this.projects.delete(projectRoot);
  }

  setLocalAddons(paths: string[]) {
    paths.forEach((element: string) => {
      const addonPath = path.resolve(element);

      if (fs.existsSync(addonPath) && isELSAddonRoot(addonPath)) {
        if (!this.localAddons.includes(addonPath)) {
          this.localAddons.push(addonPath);
        }
      }
    });
  }

  setIgnoreRoots(ignoreRoots: string[]) {
    this.ignoreRoots = ignoreRoots;
  }

  findProjectsInsideRoot(workspaceRoot: string) {
    const roots = walkSync(workspaceRoot, {
      directories: false,
      globs: ['**/ember-cli-build.js', '**/package.json'],
      ignore: ['**/.git/**', '**/bower_components/**', '**/dist/**', '**/node_modules/**', '**/tmp/**'],
    });

    roots.forEach((rootPath: string) => {
      const filePath = path.join(workspaceRoot, rootPath);
      const fullPath = path.dirname(filePath);

      if (filePath.endsWith('package.json')) {
        try {
          if (isGlimmerNativeProject(fullPath) || isGlimmerXProject(fullPath)) {
            this.onProjectAdd(fullPath);
          }
        } catch (e) {
          logError(e);
        }
      } else {
        this.onProjectAdd(fullPath);
      }
    });
  }

  async initialize(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;

    this.findProjectsInsideRoot(this.workspaceRoot);
  }

  onProjectAdd(rawPath: string) {
    const projectPath = path.resolve(URI.parse(rawPath).fsPath);

    if (this.projects.has(projectPath)) {
      const project = this.projects.get(projectPath) as Project;

      return {
        initIssues: project.initIssues,
        providers: project.providers,
        addonsMeta: project.addonsMeta,
        name: project.name,
        registry: this.server.getRegistry(project.roots),
      };
    }

    try {
      const project = new Project(projectPath, this.localAddons);

      this.projects.set(projectPath, project);
      logInfo(`Ember CLI project added at ${projectPath}`);
      project.init(this.server);

      return {
        initIssues: project.initIssues,
        providers: project.providers,
        addonsMeta: project.addonsMeta,
        name: project.name,
        registry: this.server.getRegistry(project.roots),
      };
    } catch (e) {
      logError(e);

      return false;
    }
  }

  projectForUri(uri: string): Project | undefined {
    const filePath = URI.parse(uri).fsPath;

    if (!filePath) {
      return;
    }

    return this.projectForPath(filePath);
  }

  projectForPath(rawPath: string): Project | undefined {
    const filePath = path.resolve(rawPath).toLowerCase();
    /*
      to fix C:\\Users\\lifeart\\AppData\\Local\\Temp\\tmp-30396kTX1RpAxCCyc
      and c:\\Users\\lifeart\\AppData\\Local\\Temp\\tmp-30396kTX1RpAxCCyc\\app\\components\\hello.hbs
      we need to lowercase items (because of capital C);
    */
    const rootMap: { [key: string]: string } = {};

    const projectRoots = (Array.from(this.projects.keys()) || [])
      .map((root) => {
        const projectName = this.projects.get(root)?.name;

        if (projectName && this.ignoreRoots.includes(projectName)) {
          return;
        }

        const lowerName = root.toLowerCase();

        rootMap[lowerName] = root;

        return lowerName;
      })
      .filter((item) => item !== undefined) as string[];

    const rawRoot = projectRoots
      .filter((root) => isRootStartingWithFilePath(root, filePath))
      .reduce((a, b) => {
        return a.length > b.length ? a : b;
      }, '');
    const root = rootMap[rawRoot] || '';

    if (root === '') {
      /* this is case for filePath from in-repo-addon, located on same level with application itself
        like:
        ====================
          my-app
            package.json {
              ember-addon: {
                paths: ['../in-repo-addon']
              }
            }
          in-repo-addon
        ====================
        it's safe to do, because root will be non empty if addon already registered as Project
      */
      const fistSubRoot = Array.from(this.projects.values())
        .filter((project) => project.name && !this.ignoreRoots.includes(project.name))
        .find((project) => project.roots.some((subRoot) => isRootStartingWithFilePath(subRoot.toLocaleLowerCase(), filePath)));

      if (fistSubRoot) {
        return fistSubRoot;
      } else {
        return undefined;
      }
    }

    return this.projects.get(root);
  }
}
