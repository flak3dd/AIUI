/**
 * AIUI-Style Response Formatter
 * Converts AI responses into AIUI-compatible format with tool call blocks,
 * citations, and structured output formatting.
 */

export interface ToolCallBlock {
  toolName: string;
  toolArgs: Record<string, any>;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  output?: string;
  error?: string;
  duration?: number;
}

export interface FileCitation {
  type: 'file' | 'snippet';
  filePath: string;
  lines?: string; // format: "start-end" for snippets
  description?: string;
}

export interface AIUIFormattedResponse {
  reasoning?: string;
  content: string;
  toolCalls?: ToolCallBlock[];
  citations?: FileCitation[];
  status?: string;
  progress?: string;
}

/**
 * Formats a tool call in AIUI style
 */
export function formatToolCall(toolName: string, toolArgs: Record<string, any>): string {
  const argsStr = Object.entries(toolArgs)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ');
  
  return `[tool_call: ${toolName} ${argsStr}]`;
}

/**
 * Formats a file citation in AIUI style
 */
export function formatFileCitation(citation: FileCitation): string {
  if (citation.type === 'snippet') {
    return `<ref_snippet file="${citation.filePath}" lines="${citation.lines || ''}" />`;
  }
  return `<ref_file file="${citation.filePath}" />`;
}

/**
 * Extracts file citations from response content
 */
export function extractFileCitations(content: string): FileCitation[] {
  const citations: FileCitation[] = [];
  
  // Match ref_file tags
  const fileRegex = /<ref_file file="([^"]+)"\s*\/>/g;
  let match;
  while ((match = fileRegex.exec(content)) !== null) {
    citations.push({
      type: 'file',
      filePath: match[1],
    });
  }
  
  // Match ref_snippet tags
  const snippetRegex = /<ref_snippet file="([^"]+)" lines="([^"]+)"\s*\/>/g;
  while ((match = snippetRegex.exec(content)) !== null) {
    citations.push({
      type: 'snippet',
      filePath: match[1],
      lines: match[2],
    });
  }
  
  return citations;
}

/**
 * Formats a complete AIUI-style response
 */
export function formatAIUIResponse(response: AIUIFormattedResponse): string {
  const parts: string[] = [];
  
  // Add reasoning section if present
  if (response.reasoning) {
    parts.push(`**Reasoning:**\n\`\`\`\n${response.reasoning}\n\`\`\`\n`);
  }
  
  // Add status/progress indicators
  if (response.status) {
    parts.push(`**Status:** ${response.status}\n`);
  }
  
  if (response.progress) {
    parts.push(`**Progress:** ${response.progress}\n`);
  }
  
  // Add tool call blocks
  if (response.toolCalls && response.toolCalls.length > 0) {
    parts.push('\n**Tool Calls:**\n');
    for (const tool of response.toolCalls) {
      const statusIcon = tool.status === 'completed' ? '✓' : 
                        tool.status === 'failed' ? '✗' : 
                        tool.status === 'executing' ? '⏳' : '○';
      
      parts.push(`${statusIcon} ${formatToolCall(tool.toolName, tool.toolArgs)}`);
      
      if (tool.duration) {
        parts.push(` (${tool.duration}ms)`);
      }
      
      if (tool.status === 'failed' && tool.error) {
        parts.push(`\n   Error: ${tool.error}`);
      }
      
      parts.push('\n');
    }
  }
  
  // Add main content
  if (response.content) {
    parts.push('\n');
    parts.push(response.content);
  }
  
  // Add citations section if present
  if (response.citations && response.citations.length > 0) {
    parts.push('\n\n**References:**\n');
    for (const citation of response.citations) {
      parts.push(`- ${formatFileCitation(citation)}\n`);
    }
  }
  
  return parts.join('');
}

/**
 * Parses AI response and converts to AIUI format
 */
export function parseToAIUIFormat(
  content: string,
  reasoning?: string,
  toolCalls?: Array<{ name: string; arguments: string }>,
): AIUIFormattedResponse {
  const result: AIUIFormattedResponse = {
    content,
    reasoning,
  };
  
  // Parse tool calls if provided
  if (toolCalls && toolCalls.length > 0) {
    result.toolCalls = toolCalls.map(tc => {
      try {
        const args = JSON.parse(tc.arguments);
        return {
          toolName: tc.name,
          toolArgs: args,
          status: 'pending',
        };
      } catch {
        return {
          toolName: tc.name,
          toolArgs: { raw: tc.arguments },
          status: 'pending',
        };
      }
    });
  }
  
  // Extract existing citations from content
  result.citations = extractFileCitations(content);
  
  return result;
}

/**
 * Enhances response content with AIUI-style formatting
 */
export function enhanceWithAIUIFormatting(content: string): string {
  let enhanced = content;
  
  // Convert common patterns to AIUI style
  // Convert "I will X" to action blocks
  enhanced = enhanced.replace(
    /I will (?:now )?([^:.]+)\.?/gi,
    '**Action:** $1'
  );
  
  // Convert "Let me X" to tool call indicators
  enhanced = enhanced.replace(
    /Let me (?:try to )?([^:.]+)\.?/gi,
    '[investigating: $1]'
  );
  
  // Convert file references to citations
  enhanced = enhanced.replace(
    /(?:file|path):[`"']?([^`"'\n]+)[`"']?/gi,
    '<ref_file file="$1" />'
  );
  
  // Convert code references to snippet citations
  enhanced = enhanced.replace(
    /(?:lines|line):[`"']?(\d+)(?:-(\d+))?[`"']?/gi,
    '<ref_snippet lines="$1-$2" />'
  );
  
  return enhanced;
}

/**
 * Formats tool execution result for display
 */
export function formatToolResult(toolName: string, result: {
  ok: boolean;
  output?: string;
  error?: string;
  duration?: number;
}): string {
  const statusIcon = result.ok ? '✓' : '✗';
  const parts: string[] = [`${statusIcon} [tool_result: ${toolName}]`];
  
  if (result.duration) {
    parts.push(` (${result.duration}ms)`);
  }
  
  if (result.ok && result.output) {
    parts.push(`\n\`\`\`\n${result.output}\n\`\`\``);
  }
  
  if (!result.ok && result.error) {
    parts.push(`\n**Error:** ${result.error}`);
  }
  
  return parts.join('');
}