/**
 * @package ext-template
 * Professional extension template for the TitanPL framework.
 */

/** Main configuration interface */
export interface Config {
  /** Secure key or secret */
  secret?: string;
  /** Custom logging function */
  log?: (msg: string) => void;
}

/** Standard Success Response */
export interface Result {
  result: string;
  status: "ok" | "error";
}

/** Main Extension class */
declare class Extension {
  constructor(config?: Config);

  /** Hash a string synchronously using bcryptjs */
  hash(data: string): string;

  /** Standard execution for processing input */
  execute(input: string): Result;
}

export default Extension;