import React, { useState } from 'react';

// Types for the IDE layout
interface IDEState {
  activeTab: 'chat' | 'code' | 'terminal' | 'preview';
  sidebarOpen: boolean;
  terminalOpen: boolean;
  chatOpen: boolean;
  codeEditor: {
    isOpen: boolean;
    file: string;
  };
}

// Sidebar component for file tree
const Sidebar: React.FC = () => {
  const files = [
    { name: 'App.tsx', type: 'tsx' },
    { name: 'styles.css', type: 'css' },
    { name: 'components', type: 'folder' },
    { name: 'lib', type: 'folder' },
  ];

  return (
    <div className="ide-sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">EXPLORER</span>
      </div>
      <div className="file-tree">
        {files.map((file, index) => (
          <div key={index} className="file-item">
            <span className={`file-icon ${file.type}`}>{file.type === 'folder' ? '📁' : '📄'}</span>
            <span className="file-name">{file.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Terminal component
const Terminal: React.FC = () => {
  const [output] = useState<string[]>([
    '$ npm start',
    'Starting development server...',
    'Ready on http://localhost:3000',
  ]);

  return (
    <div className="ide-terminal">
      <div className="terminal-header">TERMINAL</div>
      <div className="terminal-body">
        {output.map((line, i) => (
          <div key={i} className="terminal-line">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
};

const DeinLayout: React.FC = () => {
  const [state] = useState<IDEState>({
    activeTab: 'chat',
    sidebarOpen: true,
    terminalOpen: true,
    chatOpen: true,
    codeEditor: { isOpen: false, file: '' },
  });

  const [messages] = useState<{ role: string; content: string }[]>([
    { role: 'assistant', content: 'Ready.' },
  ]);

  const [code] = useState('// editor');

  return (
    <div className="ide-root">
      <div className="ide-body">
        {state.sidebarOpen && <Sidebar />}
        <div className="ide-main">
          <div className="ide-panel chat-panel">
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.content}
              </div>
            ))}
          </div>
          {state.codeEditor.isOpen && (
            <div className="ide-panel code-panel">
              <pre>{code}</pre>
            </div>
          )}
          {state.terminalOpen && (
            <div className="ide-panel terminal-panel">
              <Terminal />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeinLayout;
