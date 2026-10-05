import { ProviderRegistry } from './registry.js';
import { GoogleRbmProvider } from './google-rbm.js';
import { InfobipProvider } from './infobip.js';
import { TwilioProvider } from './twilio.js';
import { SinchProvider } from './sinch.js';
import { ZenviaProvider } from './zenvia.js';
/** Built-ins are available for configuration; account verification is per connection. No network I/O. */
export function documentedProviderRegistry() {
  const registry = new ProviderRegistry();
  const entries = [
    [new GoogleRbmProvider(), 'google-rbm', 'https://developers.google.com/business-communications/rcs-business-messaging'],
    [new InfobipProvider(), 'infobip', 'https://www.infobip.com/docs/tutorials/send-rcs-messages-to-end-users'],
    [new TwilioProvider(), 'twilio', 'https://www.twilio.com/docs/rcs/send-an-rcs-message'],
    [new SinchProvider(), 'sinch', 'https://developers.sinch.com/docs/conversation/callbacks'],
    [new ZenviaProvider(), 'zenvia', 'https://zenvia.github.io/zenvia-openapi-spec/v2/openapi.json'],
  ] as const;
  for (const [adapter, name, reference] of entries) registry.register(adapter, { documentPath: `docs/providers/${name}.md`, reviewedAt: '2026-10-04', references: [reference], checks: { documentationReviewed: true, evidenceRecorded: true, contractTestsPassed: true, connectionTestPassed: false, credentialHandlingValidated: true, webhookValidationTested: true } }, { requireConnectionProof: false });
  return registry;
}
