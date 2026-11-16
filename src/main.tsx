import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { DEFAULT_CHARACTER, prefetchCharacterModel } from './utils/bd2Assets';

// Start downloading default character's Spine assets immediately in parallel with React mount
prefetchCharacterModel(DEFAULT_CHARACTER, 'character');

createRoot(document.getElementById('root')!).render(<App />);
