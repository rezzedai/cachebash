'use client';

import { useState } from 'react';
import styles from './CodeBlock.module.css';

// Minimal TypeScript syntax highlighter — no external dependencies
function highlightTS(code: string): string {
  const keywords = /\b(import|from|const|let|var|async|await|function|return|if|else|for|of|new|export|type|interface|class|extends|implements|typeof|keyof|as|in|is)\b/g;
  const types = /\b(string|number|boolean|void|null|undefined|any|never|Promise|Record|Array)\b/g;
  const strings = /(["'`])(?:(?!\1|\\).|\\.)*\1/g;
  const comments = /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm;
  const numbers = /\b(\d+\.?\d*)\b/g;
  const templateLiterals = /(\$\{[^}]*\})/g;

  // Process in order: comments and strings first to prevent keyword highlighting inside them
  const segments: { start: number; end: number; html: string }[] = [];

  // Find comments
  let match;
  const commentRe = /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm;
  while ((match = commentRe.exec(code)) !== null) {
    segments.push({
      start: match.index,
      end: match.index + match[0].length,
      html: `<span class="${styles.comment}">${escapeHtml(match[0])}</span>`,
    });
  }

  // Find strings
  const stringRe = /(["'`])(?:(?!\1|\\).|\\.)*\1/g;
  while ((match = stringRe.exec(code)) !== null) {
    const overlaps = segments.some(
      (s) => match!.index < s.end && match!.index + match![0].length > s.start
    );
    if (!overlaps) {
      segments.push({
        start: match.index,
        end: match.index + match[0].length,
        html: `<span class="${styles.string}">${escapeHtml(match[0])}</span>`,
      });
    }
  }

  segments.sort((a, b) => a.start - b.start);

  // Build output, highlighting keywords/types/numbers in non-segment regions
  let result = '';
  let pos = 0;

  for (const seg of segments) {
    if (seg.start > pos) {
      result += highlightPlain(code.slice(pos, seg.start));
    }
    result += seg.html;
    pos = seg.end;
  }
  if (pos < code.length) {
    result += highlightPlain(code.slice(pos));
  }

  return result;

  function highlightPlain(text: string): string {
    return escapeHtml(text)
      .replace(
        /\b(import|from|const|let|var|async|await|function|return|if|else|for|of|new|export|type|interface|class|extends|implements|typeof|keyof|as|in|is)\b/g,
        `<span class="${styles.keyword}">$1</span>`
      )
      .replace(
        /\b(string|number|boolean|void|null|undefined|any|never|Promise|Record|Array|CacheBashMemory)\b/g,
        `<span class="${styles.type}">$1</span>`
      )
      .replace(
        /\b(\d+\.?\d*)\b/g,
        `<span class="${styles.number}">$1</span>`
      );
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightJSON(code: string): string {
  return escapeHtml(code)
    .replace(
      /("(?:[^"\\]|\\.)*")\s*:/g,
      `<span class="${styles.keyword}">$1</span>:`
    )
    .replace(
      /:\s*("(?:[^"\\]|\\.)*")/g,
      `: <span class="${styles.string}">$1</span>`
    )
    .replace(
      /:\s*(\d+\.?\d*)/g,
      `: <span class="${styles.number}">$1</span>`
    )
    .replace(
      /:\s*(true|false|null)\b/g,
      `: <span class="${styles.keyword}">$1</span>`
    );
}

function highlightBash(code: string): string {
  return escapeHtml(code)
    .replace(
      /^(npm|npx)\b/gm,
      `<span class="${styles.keyword}">$1</span>`
    )
    .replace(
      /(install|init)\b/g,
      `<span class="${styles.type}">$1</span>`
    )
    .replace(
      /(@rezzed\.ai\/\S+)/g,
      `<span class="${styles.string}">$1</span>`
    );
}

interface CodeBlockProps {
  code: string;
  language?: 'typescript' | 'json' | 'bash';
  filename?: string;
}

export default function CodeBlock({ code, language = 'typescript', filename }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const highlighted =
    language === 'json'
      ? highlightJSON(code)
      : language === 'bash'
        ? highlightBash(code)
        : highlightTS(code);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        {filename && <span className={styles.filename}>{filename}</span>}
        <span className={styles.lang}>{language}</span>
        <button
          onClick={handleCopy}
          className={styles.copyBtn}
          aria-label="Copy code"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className={styles.pre}>
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}
