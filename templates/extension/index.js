import { ext } from "./ext.js";

export default class Extension {
  /**
   * Adds two numbers using the native Rust implementation.
   * @param {number} n1
   * @param {number} n2
   * @returns {Promise<number>}
   */
  addNumber(n1, n2) {
    return ext.call("add_number", { n1, n2 });
  }
}
