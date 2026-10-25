/**
 * Single access point to Babel. Runtime code comes from the browser-safe standalone build (also used
 * by Vitest in Node); types come from the matching Babel 8 packages (standalone's own typings
 * re-export them type-only, which would otherwise erase narrowing).
 */
import * as BabelModule from '@babel/standalone';
import type * as BabelTypesNs from '@babel/types';
import type * as BabelParserNs from '@babel/parser';
import type { generate as GenerateFn } from '@babel/generator';
import type TraverseFn from '@babel/traverse';

interface StandalonePackages {
  types: unknown;
  parser: unknown;
  traverse: { default: unknown };
  generator: { generate: unknown };
}
// CommonJS interop differs between Vite (browser), Vitest and tsx: accept both module shapes.
const mod = BabelModule as unknown as { packages?: StandalonePackages; default?: { packages?: StandalonePackages } };
const resolved = mod.packages ?? mod.default?.packages;
if (!resolved) throw new Error('@babel/standalone failed to load');
const packages: StandalonePackages = resolved;

export const t = packages.types as typeof BabelTypesNs;
export const parser = packages.parser as typeof BabelParserNs;
export const traverse = packages.traverse.default as typeof TraverseFn;
export const generate = packages.generator.generate as typeof GenerateFn;

export type { NodePath } from '@babel/traverse';
/** Node types namespace: `BabelTypes.Identifier`, `BabelTypes.MemberExpression`, … */
export type * as BabelTypes from '@babel/types';
export type Node = BabelTypesNs.Node;
export type Expression = BabelTypesNs.Expression;
export type Statement = BabelTypesNs.Statement;
export type Identifier = BabelTypesNs.Identifier;
export type LVal = BabelTypesNs.LVal;
export type FunctionNode = BabelTypesNs.Function;
export type ClassNode = BabelTypesNs.Class;
export type Program = BabelTypesNs.Program;
export type BlockStatement = BabelTypesNs.BlockStatement;
