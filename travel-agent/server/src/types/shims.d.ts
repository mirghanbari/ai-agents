// puppeteer-extra-plugin-stealth ships no type declarations.
declare module 'puppeteer-extra-plugin-stealth' {
  const StealthPlugin: () => unknown;
  export default StealthPlugin;
}
