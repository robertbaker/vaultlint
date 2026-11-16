import { bitwardenProvider } from "./bitwarden";
import { dashlaneProvider } from "./dashlane";
import { enpassProvider } from "./enpass";
import { keeperProvider } from "./keeper";
import { lastpassProvider } from "./lastpass";
import { nordPassProvider } from "./nordpass";
import { onePasswordProvider } from "./onepassword";
import { protonPassProvider } from "./protonpass";
import { nodeCommandRunner } from "./runner";
import type { CommandRunner, VendorCliId, VendorCliProvider } from "./types";

export * from "./types";
export { nodeCommandRunner } from "./runner";

export const VENDOR_CLI_PROVIDERS: Record<VendorCliId, VendorCliProvider> = {
  bitwarden: bitwardenProvider,
  lastpass: lastpassProvider,
  dashlane: dashlaneProvider,
  keeper: keeperProvider,
  "proton-pass": protonPassProvider,
  nordpass: nordPassProvider,
  "1password": onePasswordProvider,
  enpass: enpassProvider,
};

export const VENDOR_CLI_IDS = Object.keys(VENDOR_CLI_PROVIDERS) as VendorCliId[];

export function isVendorCliId(value: string): value is VendorCliId {
  return Object.hasOwn(VENDOR_CLI_PROVIDERS, value);
}

export function getVendorCliProvider(id: VendorCliId): VendorCliProvider {
  return VENDOR_CLI_PROVIDERS[id];
}

export function describeVendorCliSupport(provider: VendorCliProvider): {
  read: boolean;
  write: boolean;
} {
  return {
    read: !provider.unsupportedReason?.read,
    write: Boolean(provider.push) && !provider.unsupportedReason?.write,
  };
}

export async function fetchFromVendorCli(
  id: VendorCliId,
  runner: CommandRunner = nodeCommandRunner,
) {
  const provider = getVendorCliProvider(id);
  await provider.ensureReady(runner);
  return { provider, ...(await provider.fetch(runner)) };
}
