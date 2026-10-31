import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { useLab } from './store';

// 开发模式下暴露状态，便于在控制台检查（生产构建中不存在）
if (import.meta.env.DEV) (window as unknown as { __lab: typeof useLab }).__lab = useLab;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
