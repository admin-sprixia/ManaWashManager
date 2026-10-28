/**
 * The WhatsApp Flow behind Services & Prices: a full-screen picker inside WhatsApp. COMPANY (a
 * searchable dropdown with each company's logo) → MODEL → PRICES (that model's washes and plans).
 * Every screen's content comes from our endpoint (POST /whatsapp/flow, answered by
 * `chatFlowReply` in whatsappChat.ts), so this JSON is only the layout; it's what gets published
 * to Meta (`npm run whatsapp:flow`). "Get this in chat" ends the Flow, and the chat then sends the
 * numbered price list, so a number picks a service as usual.
 */

/** A 1 × 1 PNG: the example image Meta's validator needs for a list with logos. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

export const WA_FLOW_NAME = 'services_and_prices';
export const WA_FLOW_VERSION = '7.1';

const text = (example: string) => ({ type: 'string', __example__: example });
const list = (example: Record<string, string>[]) => ({
  type: 'array',
  items: { type: 'object', properties: Object.fromEntries(Object.keys(example[0]!).map((k) => [k, { type: 'string' }])) },
  __example__: example,
});

export const WA_FLOW_JSON = {
  version: WA_FLOW_VERSION,
  data_api_version: '3.0',
  routing_model: { COMPANY: ['MODEL'], MODEL: ['PRICES'], PRICES: [] },
  screens: [
    {
      id: 'COMPANY',
      title: 'Services & Prices',
      data: {
        heading: text('Which company makes your car?'),
        label: text('Company'),
        next: text('Next'),
        companies: list([{ id: 'Maruti Suzuki', title: 'Maruti Suzuki', image: PIXEL, 'alt-text': 'Maruti Suzuki logo' }]),
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            type: 'Form',
            name: 'company_form',
            children: [
              { type: 'TextSubheading', text: '${data.heading}' },
              { type: 'Dropdown', name: 'company', label: '${data.label}', required: true, 'data-source': '${data.companies}' },
              {
                type: 'Footer',
                label: '${data.next}',
                'on-click-action': { name: 'data_exchange', payload: { step: 'company', company: '${form.company}' } },
              },
            ],
          },
        ],
      },
    },
    {
      id: 'MODEL',
      title: 'Services & Prices',
      data: {
        heading: text('Which Maruti Suzuki is it?'),
        label: text('Model'),
        next: text('See prices'),
        company: text('Maruti Suzuki'),
        models: list([{ id: 'Swift', title: 'Swift', description: 'Hatchback' }]),
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            type: 'Form',
            name: 'model_form',
            children: [
              { type: 'TextSubheading', text: '${data.heading}' },
              { type: 'Dropdown', name: 'model', label: '${data.label}', required: true, 'data-source': '${data.models}' },
              {
                type: 'Footer',
                label: '${data.next}',
                'on-click-action': { name: 'data_exchange', payload: { step: 'model', company: '${data.company}', model: '${form.model}' } },
              },
            ],
          },
        ],
      },
    },
    {
      id: 'PRICES',
      title: 'Services & Prices',
      terminal: true,
      success: true,
      data: {
        company: text('Maruti Suzuki'),
        model: text('Swift'),
        prices: text('# Maruti Suzuki Swift\n1. **Basic Wash** — ₹471'),
        done: text('Get this in chat'),
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'RichText', text: '${data.prices}' },
          {
            type: 'Footer',
            label: '${data.done}',
            'on-click-action': { name: 'complete', payload: { company: '${data.company}', model: '${data.model}' } },
          },
        ],
      },
    },
  ],
} as const;
