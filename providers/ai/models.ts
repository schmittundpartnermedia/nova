/**
 * Modell des Kopfes. Organization-Override: AiProviderConfig (role "master", Feld model).
 * Tool-Calling läuft über die OpenAI Responses API.
 */
// NOVA_KOPF_MODELL nur für Vergleichsläufe der Nachweise; die App nimmt den Standard bzw. AiProviderConfig.
export const HEAD_MODEL = process.env.NOVA_KOPF_MODELL?.trim() || "gpt-6-astra";
