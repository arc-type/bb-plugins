/**
 * Choosing the model that condenses an answer when the user named none.
 *
 * Turning one reply into three sentences does not need the project's coding
 * model. The cheapest model of whichever provider is installed and signed in
 * is plenty, so that is what "no opinion" resolves to — rather than the
 * project default, which is usually the most expensive one.
 */

export type ProviderEntry = { id: string; available: boolean };
export type ModelEntry = { id: string; model: string; isDefault: boolean };

/** Names that mark a provider's small, fast tier across the common vendors. */
const SMALL_MODEL = /haiku|mini|flash|nano|lite|small|fast/i;

export type PickedModel = { providerId: string; model: string };

/**
 * First available provider that lists any model wins; inside it a small model
 * is preferred over the provider's default, which beats the first listed.
 * Returns null when nothing is installed, so the caller can fall back to the
 * project default instead of failing.
 */
export async function pickModel(
  providers: ProviderEntry[],
  loadModels: (providerId: string) => Promise<ModelEntry[]>,
): Promise<PickedModel | null> {
  for (const provider of providers) {
    if (!provider.available) continue;
    let models: ModelEntry[];
    try {
      models = await loadModels(provider.id);
    } catch {
      // One provider failing to list its models must not hide the next one.
      continue;
    }
    const best =
      models.find((entry) => SMALL_MODEL.test(entry.model)) ??
      models.find((entry) => entry.isDefault) ??
      models[0];
    if (best !== undefined) return { providerId: provider.id, model: best.model };
  }
  return null;
}
