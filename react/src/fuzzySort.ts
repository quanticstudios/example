import * as fuzzysort from "fuzzysort";
import Options = Fuzzysort.Options;
import KeysOptions = Fuzzysort.KeysOptions;

/**
 * @template T The generic type parameter
 * @function handleFuzzySort
 * @param {string} search The search string.
 * @param {string[]} data When handleFuzzySort is called with two arguments, data is an array of strings.
 * @returns {string[]} Returns Results when handleFuzzySort is called with two arguments.
 */
export function handleFuzzySort(search: string, data: string[]): string[];

/**
 * @function handleFuzzySort
 * @param {string} search The search string.
 * @param {T[]} data When handleFuzzySort is called with three arguments, data is an array of type T.
 * @param {KeysOptions<T> | string} searchParams Options for FuzzySort algorithm.
 * @returns {T[]} Returns an array of type T when handleFuzzySort is called with three arguments.
 */
export function handleFuzzySort<T>(search: string, data: T[], searchParams: KeysOptions<T> | string): T[];

/**
 * Accepts any number of arguments based on the overloads and returns the result of the function call.
 * @function handleFuzzySort
 * @param {...unknown[]} args The function can accept any number of arguments.
 */
export function handleFuzzySort<T>(...args: unknown[]): string[] | T[] {
  const defaultOptions: Options = {
    threshold: -10_000,
    limit: Infinity,
    all: true,
  };
  if (args.length === 2) {
    const [search, data] = args as [string, string[]];

    if (search === "") return data;

    return fuzzysort.go(search, data, defaultOptions).reduce((acc, { target }) => {
      acc.push(target);
      return acc;
    }, [] as string[]);
  }

  const [search, data, searchParams] = args as [string, T[], KeysOptions<T> | string];

  if (search === "") return data;

  const keys = typeof searchParams === "string" ? [searchParams] : searchParams.keys;
  return fuzzysort.go(search, data, { ...defaultOptions, keys }).reduce((acc, { obj }) => {
    acc.push(obj);
    return acc;
  }, [] as T[]);
}
