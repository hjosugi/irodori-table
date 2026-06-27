export * from "./generated/irodori-extension-api";
export { defineManifest } from "./manifest";
export {
  createFakeDatabase,
  createResultGridSnapshot,
  formatResultGridAsMarkdown,
} from "./testing";

import type {
  ExtensionManifest,
  KeybindingContribution,
  PermissionInspection,
  PermissionScope,
  ResultGridActionContribution,
  ResultGridSelection,
  ResultGridSnapshot,
  SqlDialectDefinition,
  StatusBarItemContribution,
  ThemeDefinition,
} from "./generated/irodori-extension-api";

export type Awaitable<T> = T | Promise<T>;

export interface Disposable {
  dispose(): void;
}

export type CommandHandler<TArgs extends readonly unknown[] = readonly unknown[], TResult = unknown> =
  (...args: TArgs) => Awaitable<TResult>;

export interface CommandRegistry {
  registerCommand<TArgs extends readonly unknown[], TResult>(
    id: string,
    handler: CommandHandler<TArgs, TResult>,
  ): Disposable;
  executeCommand<TResult = unknown>(id: string, ...args: readonly unknown[]): Promise<TResult>;
}

export interface KeybindingRegistry {
  registerKeybinding(keybinding: KeybindingContribution): Disposable;
}

export interface ResultGridApi {
  getActiveSnapshot(): Promise<ResultGridSnapshot | undefined>;
  getSelection(): Promise<ResultGridSelection | undefined>;
  registerAction(action: ResultGridActionContribution, handler: CommandHandler): Disposable;
  copyText(text: string): Promise<void>;
}

export interface ThemeRegistry {
  registerTheme(theme: ThemeDefinition): Disposable;
}

export interface SqlDialectRegistry {
  registerDialect(dialect: SqlDialectDefinition): Disposable;
}

export interface StatusBarRegistry {
  registerItem(item: StatusBarItemContribution): Disposable;
}

export interface PermissionApi {
  has(scope: PermissionScope): boolean;
  require(scope: PermissionScope): void;
  inspect(): PermissionInspection;
}

export interface ExtensionLogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export interface ExtensionContext {
  readonly manifest: ExtensionManifest;
  readonly extensionPath: string;
  readonly subscriptions: Disposable[];
  readonly commands: CommandRegistry;
  readonly keybindings: KeybindingRegistry;
  readonly resultGrid: ResultGridApi;
  readonly themes: ThemeRegistry;
  readonly sqlDialects: SqlDialectRegistry;
  readonly statusBar: StatusBarRegistry;
  readonly permissions: PermissionApi;
  readonly log: ExtensionLogger;
}

export type ExtensionActivation = (context: ExtensionContext) => Awaitable<void>;
export type ExtensionDeactivation = () => Awaitable<void>;

export interface ExtensionModule {
  activate: ExtensionActivation;
  deactivate?: ExtensionDeactivation;
}

export function defineExtension(activate: ExtensionActivation, deactivate?: ExtensionDeactivation): ExtensionModule {
  return deactivate ? { activate, deactivate } : { activate };
}

export function disposeAll(disposables: readonly Disposable[]): void {
  for (let index = disposables.length - 1; index >= 0; index -= 1) {
    disposables[index]?.dispose();
  }
}
