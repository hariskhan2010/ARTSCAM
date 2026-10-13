import { PROJECT_FORMAT, PROJECT_VERSION } from '@naqsh/core';
import { appTitle } from './title';

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>{appTitle()}</h1>
      <p>
        Relief-carving CAD/CAM. Project format: {PROJECT_FORMAT} v{PROJECT_VERSION}
      </p>
    </main>
  );
}
