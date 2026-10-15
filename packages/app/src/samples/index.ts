import calligraphy from './calligraphy.json';
import reliefPanel from './relief-panel.json';
import sign from './sign.json';

/** Sample projects for Help › Samples (plan.md T7.2); built by samples.test.ts. */
export const SAMPLES: readonly { id: string; name: string; text: string; project: unknown }[] = [
  {
    id: 'sign',
    name: 'House sign',
    text: 'Cut-out with tabs, a recessed panel and four mounting holes',
    project: sign,
  },
  {
    id: 'calligraphy',
    name: 'Calligraphy plaque',
    text: 'Nastaliq text V-carved inside an oval, then cut out',
    project: calligraphy,
  },
  {
    id: 'relief-panel',
    name: 'Relief panel',
    text: 'Framed border, rosette, leaves and a hammered background; rough + finish',
    project: reliefPanel,
  },
];
