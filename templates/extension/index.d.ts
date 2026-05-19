/**
 * @package @ext/rust-extension
 * Professional Rust extension template for the TitanPL framework.
 */

/** Main Extension class */
declare class Extension {
  /**
   * Adds two numbers using the native implementation.
   * @param n1 First number
   * @param n2 Second number
   * @returns Promise resolving to the sum
   */
  addNumber(n1: number, n2: number): Promise<number>;
}

export default Extension;