/**
 * AIUI AGENT TOOL REGISTRY
 * Standardized OpenAI-compatible tool definitions (schemas) for all built-in AIUI agent capabilities.
 */

export const tools = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute a shell command inside local Mac, DGX Spark, or isolated Linux container. Returns real stdout, stderr, and exitCode.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The exact bash command line to run' },
          target: { type: 'string', enum: ['dgx_spark', 'local_mac', 'container'], description: 'Execution target (default: active target)' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_file_content',
      description: 'Surgically replace an exact, unique block of code within a file without modifying the rest of the file. Eliminates line drift, whole-file rewrite context bloat, and truncation corruption.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file path' },
          target: { type: 'string', description: 'The exact character sequence to be replaced (must be unique)' },
          replacement: { type: 'string', description: 'The replacement code' },
        },
        required: ['path', 'target', 'replacement'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'multi_replace_file_content',
      description: 'Atomically apply multiple surgical code replacements to a file in a single transaction.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file path' },
          replacements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                target: { type: 'string', description: 'Exact character sequence to replace' },
                replacement: { type: 'string', description: 'Replacement code' },
              },
              required: ['target', 'replacement'],
            },
            description: 'List of target and replacement hunks',
          },
        },
        required: ['path', 'replacements'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep_search',
      description: 'Fast code search using ripgrep (rg). Supports regex, glob filters, and path scoping.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (regex or literal string)' },
          path: { type: 'string', description: 'Target directory or file path to search in (default: workspace)' },
          glob: { type: 'string', description: 'Glob filter (e.g. *.ts, !*.test.js)' },
          case_sensitive: { type: 'boolean', description: 'Whether search is case-sensitive (default: false)' },
          max_results: { type: 'number', description: 'Maximum matching lines to return (default: 50)' },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_file_outline',
      description: 'Extract function, class, interface, and type signatures with line numbers using regex AST.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to source file' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. Returns line numbers. Supply start_line and line_count for targeted reading.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path of the file to read' },
          start_line: { type: 'number', description: 'Optional 1-indexed starting line number (default: 1)' },
          line_count: { type: 'number', description: 'Optional number of lines to read' },
          target: { type: 'string', enum: ['dgx_spark', 'local_mac', 'container'], description: 'Execution target' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create a new file or completely overwrite an existing file. For existing files, prefer replace_file_content for surgical edits.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to create/overwrite' },
          content: { type: 'string', description: 'Complete content to write into the file' },
          target: { type: 'string', enum: ['dgx_spark', 'local_mac', 'container'], description: 'Execution target' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_daemon',
      description: 'Start a long-running background daemon process (npm run dev, python -m http.server, etc.) with optional port readiness polling.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          id: { type: 'string', description: 'Unique identifier for daemon' },
          port: { type: 'number', description: 'Port to poll until server is ready (e.g. 5173, 3000)' },
          cwd: { type: 'string', description: 'Working directory for the process' },
        },
        required: ['command', 'id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_daemon_logs',
      description: 'Read trailing log lines from a running background daemon.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Daemon process ID' },
          lines: { type: 'number', description: 'Number of lines to read (default: 50)' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_daemon',
      description: 'Stop a running background daemon.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Daemon process ID' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_daemons',
      description: 'List all currently running background daemons, their PIDs, uptime, and ports.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nl_automate',
      description: 'Run a natural-language web automation command on the allowlisted local studio. Example: "Open the local studio, click Settings, go to the Health tab, and read the endpoint list."',
      parameters: {
        type: 'object',
        properties: {
          instruction: { type: 'string', description: 'Plain-language browser task' },
        },
        required: ['instruction'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_open',
      description: 'Open a visible Chrome window (Playwright) and navigate to a URL. Captures page console logs and runtime exceptions. Pass headless true only when a window must stay hidden.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to (e.g. http://localhost:5173)' },
          headless: { type: 'boolean', description: 'Hide the window. Default false, so Chrome is visible.' },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description: 'Capture viewport or full-page PNG screenshot of active browser page and save to disk.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Output PNG file path (default: session artifacts directory)' },
          fullPage: { type: 'boolean', description: 'Capture full page height (default: false)' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click an element on the active browser page by CSS selector.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of element to click' },
        },
        required: ['selector'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Type text into an input field or textarea on the active browser page.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of input element' },
          text: { type: 'string', description: 'Text to type' },
        },
        required: ['selector', 'text'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_console_logs',
      description: 'Get browser console logs, uncaught exceptions, and network errors.',
      parameters: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['error', 'warn', 'info', 'all'], description: 'Log level filter (default: all)' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawn_subagent',
      description: 'Delegate a focused micro-objective to an isolated worker subagent (recon, coder, browser_qa) with a clean context window to avoid context exhaustion.',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['recon', 'coder', 'browser_qa'], description: 'Specialized role of the subagent' },
          objective: { type: 'string', description: 'Clear, concise sub-objective for the worker to fulfill' },
          target_files: { type: 'array', items: { type: 'string' }, description: 'Target files to focus on' },
          max_rounds: { type: 'number', description: 'Maximum turns for subagent (default: 10)' },
        },
        required: ['role', 'objective'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_acquired_tools',
      description: 'List all dynamically acquired and installed tools in your architecture.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_acquired_tool',
      description: 'Unload and remove an acquired dynamic tool from your architecture.',
      parameters: {
        type: 'object',
        properties: {
          tool_name: { type: 'string', description: 'Name of the tool to remove' },
        },
        required: ['tool_name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'hand_off_run',
      description: 'Give the current run to n8n so it continues after this chat closes. Posts the run id and checkpoint to the durable intake webhook. Does not drive a browser.',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Run id. Defaults to the active run.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_unblocker',
      description: 'Fetch and unblock protected web pages using Bright Data Web Unlocker. Solves CAPTCHAs, defeats Cloudflare/Datadome, and uses manual expect elements to wait for SPA dynamic content or form mounting before returning.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target website URL to unlock' },
          expectElement: { type: 'string', description: 'CSS selector that must be present in the DOM before returning (e.g. "form input[type=email]")' },
          expectPreset: { type: 'string', enum: ['FORM_INPUTS', 'SIGNUP_FORM', 'LOGIN_FORM', 'CHECKOUT_FORM', 'SPA_READY'], description: 'Pre-configured expect selector preset' },
          expectText: { type: 'string', description: 'Specific text that must be rendered on the page before returning' },
          dataFormat: { type: 'string', enum: ['markdown', 'raw', 'screenshot'], description: 'Output format (markdown is optimal for LLM comprehension)' },
          render: { type: 'boolean', description: 'Force full headless browser JavaScript rendering (default: true)' },
          country: { type: 'string', description: 'Two-letter ISO country code for geo-targeting (e.g. "us", "gb", "au")' },
          headers: { type: 'object', description: 'Custom request headers. Requires Custom headers & cookies enabled on the Bright Data zone.', additionalProperties: { type: 'string' } },
          cookies: { description: 'Cookie header string, name/value object, or [{name,value}]. Same zone toggle as headers.' },
          async: { type: 'boolean', description: 'Submit in the background and collect by response id. Requires Asynchronous requests enabled on the zone.' },
          wait: { type: 'boolean', description: 'When async, poll until the result is ready. Set false to return the response id immediately.' },
          webhookUrl: { type: 'string', description: 'Web Hook URL. Bright Data calls this when an async job finishes.' },
          webhookMethod: { type: 'string', enum: ['GET', 'POST'], description: 'Web Hook Request Method. GET or POST.' },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_models',
      description: 'List model IDs from the active provider GET /v1/models.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional substring filter' },
          limit: { type: 'number', description: 'Max results (default 30)' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'http_get_json',
      description:
        'GET a public http(s) URL and return status, finalUrl, truncated body, and body metadata. Uses Bright Data residential SuperProxy when BRIGHTDATA_* env is set; otherwise direct. Not browser proof.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'now',
      description: 'Return the current UTC time.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_search',
      description: 'Search MemPalace for past decisions and project context.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          wing: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_checkpoint',
      description: 'Save verbatim items to MemPalace under a wing and room.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                wing: { type: 'string' },
                room: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['wing', 'room', 'content'],
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawn_linux_container',
      description: 'Start an isolated Linux container for the sandbox runner.',
      parameters: {
        type: 'object',
        properties: {
          envId: { type: 'string' },
          profile: { type: 'string', enum: ['python_data', 'gpu_spark', 'minimal_alpine'] },
          target: { type: 'string', enum: ['dgx_spark', 'local_mac'] },
          timeoutMinutes: { type: 'number' },
          enableGpu: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'destroy_linux_container',
      description: 'Stop an ephemeral Linux container.',
      parameters: {
        type: 'object',
        properties: {
          envId: { type: 'string' },
          target: { type: 'string', enum: ['dgx_spark', 'local_mac'] },
        },
        required: ['envId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_linux_containers',
      description: 'List running sandbox containers.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_scaffolds',
      description: 'List project scaffolds the agent can apply.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_scaffold',
      description: 'Write a project scaffold into the workspace.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string' },
          projectName: { type: 'string' },
          target: { type: 'string', enum: ['local_mac', 'dgx_spark'] },
        },
        required: ['templateId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_workspace_dir',
      description: 'Change the working directory for later file and shell tools.',
      parameters: {
        type: 'object',
        properties: {
          directory: { type: 'string' },
          target: { type: 'string', enum: ['local_mac', 'dgx_spark'] },
        },
        required: ['directory'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_workspace_dir',
      description: 'Return the active workspace directory.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: ['local_mac', 'dgx_spark'] },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ssh',
      description: 'Run a command on a remote host over SSH. Defaults to the Spark host.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          host: { type: 'string' },
          user: { type: 'string' },
          port: { type: 'number' },
          timeoutSeconds: { type: 'number' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'base64',
      description: 'Encode or decode a string as base64.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['encode', 'decode'] },
          data: { type: 'string' },
          urlSafe: { type: 'boolean' },
        },
        required: ['data'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'research_and_acquire_tool',
      description: 'Find and install an extra tool into the agent registry.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          query: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  },
];

export const AGENT_TOOLS = tools;
