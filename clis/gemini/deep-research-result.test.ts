import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/types';

const {
  mockClickGeminiConversationByTitle,
  mockExportGeminiDeepResearchReport,
  mockGetGeminiConversationList,
  mockGetGeminiPageState,
  mockGetLatestGeminiAssistantResponse,
  mockReadGeminiSnapshot,
  mockResolveGeminiConversationForQuery,
  mockWaitForGeminiTranscript,
} = vi.hoisted(() => ({
  mockClickGeminiConversationByTitle: vi.fn(),
  mockExportGeminiDeepResearchReport: vi.fn(),
  mockGetGeminiConversationList: vi.fn(),
  mockGetGeminiPageState: vi.fn(),
  mockGetLatestGeminiAssistantResponse: vi.fn(),
  mockReadGeminiSnapshot: vi.fn(),
  mockResolveGeminiConversationForQuery: vi.fn(),
  mockWaitForGeminiTranscript: vi.fn(),
}));

vi.mock('./utils.js', () => ({
  GEMINI_DOMAIN: 'gemini.google.com',
  clickGeminiConversationByTitle: mockClickGeminiConversationByTitle,
  exportGeminiDeepResearchReport: mockExportGeminiDeepResearchReport,
  getGeminiConversationList: mockGetGeminiConversationList,
  getGeminiPageState: mockGetGeminiPageState,
  getLatestGeminiAssistantResponse: mockGetLatestGeminiAssistantResponse,
  isDeepResearchInProgressText: (value: unknown) => /\bresearching(?:\s+websites?)?\b|research in progress|working on your research|gathering sources|creating report|正在研究|研究中|调研中|搜集资料|请稍候|稍候|请等待/i.test(String(value ?? '')),
  isDeepResearchWaitingForStartText: (value: unknown) => /\bstart(?:\s+deep)?\s+research\b|begin\s+research|generat(?:e|ing)(?:\s+deep)?\s+research\s+plan|开始研究|开始深度研究|开始调研|生成研究计划|生成调研计划|try again without deep research/i.test(String(value ?? '')),
  isDeepResearchCompletedText: (value: unknown) => /\bresearch(?:\s+is)?\s+complete(?:d)?\b|\b(?:completed\s+(?:deep\s+)?research|(?:deep\s+)?research\s+completed|report\s+completed|completed\s+report)\b|已完成|研究完成|完成了研究|报告已完成/i.test(String(value ?? '')),
  readGeminiSnapshot: mockReadGeminiSnapshot,
  parseGeminiConversationUrl: (value: unknown) => {
    const raw = String(value ?? '').trim();
    return raw.startsWith('https://gemini.google.com/app/') ? raw : null;
  },
  parseGeminiTitleMatchMode: (value: unknown) => {
    const raw = String(value ?? 'contains').trim().toLowerCase();
    if (raw === 'contains' || raw === 'exact') return raw;
    return null;
  },
  resolveGeminiConversationForQuery: mockResolveGeminiConversationForQuery,
  waitForGeminiTranscript: mockWaitForGeminiTranscript,
}));

import { deepResearchResultCommand } from './deep-research-result.js';

describe('gemini/deep-research-result', () => {
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
  } as unknown as IPage;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGeminiPageState.mockResolvedValue({ isSignedIn: true });
    mockGetGeminiConversationList.mockResolvedValue([{ Title: 'A title', Url: 'https://gemini.google.com/app/abc' }]);
    mockResolveGeminiConversationForQuery.mockReturnValue({ Title: 'A title', Url: 'https://gemini.google.com/app/abc' });
    mockClickGeminiConversationByTitle.mockResolvedValue(true);
    mockWaitForGeminiTranscript.mockResolvedValue(['line']);
    mockExportGeminiDeepResearchReport.mockResolvedValue({ url: 'https://files.example.com/report.md', source: 'network' });
    mockGetLatestGeminiAssistantResponse.mockResolvedValue('Final answer');
    mockReadGeminiSnapshot.mockResolvedValue({
      turns: [],
      transcriptLines: [],
      composerHasText: false,
      isGenerating: false,
      structuredTurnsTrusted: true,
    });
  });

  it('uses latest conversation when query is empty', async () => {
    const result = await deepResearchResultCommand.func!(page, { query: '   ' });

    expect(page.goto).toHaveBeenCalledWith('https://gemini.google.com/app/abc', { waitUntil: 'load', settleMs: 2500 });
    expect(result).toEqual([{ response: 'https://files.example.com/report.md' }]);
  });

  it('falls back to current page response when query is empty and sidebar has no conversations', async () => {
    mockGetGeminiConversationList.mockResolvedValue([]);
    mockResolveGeminiConversationForQuery.mockReturnValue(null);

    const result = await deepResearchResultCommand.func!(page, { query: '' });

    expect(page.goto).not.toHaveBeenCalled();
    expect(result).toEqual([{ response: 'https://files.example.com/report.md' }]);
  });

  it('returns a validation message when match mode is invalid', async () => {
    const result = await deepResearchResultCommand.func!(page, { query: 'A', match: 'prefix' });
    expect(result).toEqual([{ response: 'Invalid match mode. Use contains or exact.' }]);
  });

  it('returns a signed-out message when Gemini page state indicates logged out', async () => {
    mockGetGeminiPageState.mockResolvedValue({ isSignedIn: false });
    const result = await deepResearchResultCommand.func!(page, { query: 'A' });
    expect(result).toEqual([{ response: 'Not signed in to Gemini.' }]);
  });

  it('opens matched conversation by URL and returns exported report url', async () => {
    const result = await deepResearchResultCommand.func!(page, { query: 'A title', match: 'exact' });

    expect(page.goto).toHaveBeenCalledWith('https://gemini.google.com/app/abc', { waitUntil: 'load', settleMs: 2500 });
    expect(result).toEqual([{ response: 'https://files.example.com/report.md' }]);
  });

  it('accepts a direct conversation URL and reads response from that page', async () => {
    const url = 'https://gemini.google.com/app/direct-id';
    const result = await deepResearchResultCommand.func!(page, { query: url, match: 'contains' });

    expect(page.goto).toHaveBeenCalledWith(url, { waitUntil: 'load', settleMs: 2500 });
    expect(result).toEqual([{ response: 'https://files.example.com/report.md' }]);
  });

  it('passes query and mode into resolveGeminiConversationForQuery', async () => {
    const result = await deepResearchResultCommand.func!(page, { query: 'title', match: 'contains' });

    expect(mockResolveGeminiConversationForQuery).toHaveBeenCalledWith(
      [{ Title: 'A title', Url: 'https://gemini.google.com/app/abc' }],
      'title',
      'contains',
    );
    expect(result).toEqual([{ response: 'https://files.example.com/report.md' }]);
  });

  it('falls back to click-by-title and returns not-found when click fails', async () => {
    mockResolveGeminiConversationForQuery.mockReturnValue(null);
    mockClickGeminiConversationByTitle.mockResolvedValue(false);

    const result = await deepResearchResultCommand.func!(page, { query: 'missing', match: 'contains' });

    expect(result).toEqual([{ response: 'No conversation matched: missing' }]);
  });

  it('returns pending message when export url is unavailable and completion is not confirmed', async () => {
    mockExportGeminiDeepResearchReport.mockResolvedValue({ url: '', source: 'none' });

    const result = await deepResearchResultCommand.func!(page, { query: 'A title' });

    expect(result).toEqual([{ response: 'Deep Research may still be running or preparing export. Please wait and retry later.' }]);
  });

  it('returns waiting message when deep research is still generating', async () => {
    mockExportGeminiDeepResearchReport.mockResolvedValue({ url: '', source: 'none' });
    mockReadGeminiSnapshot.mockResolvedValue({
      turns: [],
      transcriptLines: [],
      composerHasText: false,
      isGenerating: true,
      structuredTurnsTrusted: true,
    });

    const result = await deepResearchResultCommand.func!(page, { query: 'A title' });

    expect(result).toEqual([{ response: 'Deep Research is still running. Please wait and retry later.' }]);
  });

  it('returns waiting message when assistant response indicates research in progress', async () => {
    mockExportGeminiDeepResearchReport.mockResolvedValue({ url: '', source: 'none' });
    mockGetLatestGeminiAssistantResponse.mockResolvedValue('正在研究中，请稍候。');

    const result = await deepResearchResultCommand.func!(page, { query: 'A title' });

    expect(result).toEqual([{ response: 'Deep Research is still running. Please wait and retry later.' }]);
  });

  it('returns waiting message when transcript indicates in-progress status', async () => {
    mockExportGeminiDeepResearchReport.mockResolvedValue({ url: '', source: 'none' });
    mockGetLatestGeminiAssistantResponse.mockResolvedValue('');
    mockReadGeminiSnapshot.mockResolvedValue({
      turns: [],
      transcriptLines: ['生成研究计划中，请稍候。'],
      composerHasText: false,
      isGenerating: false,
      structuredTurnsTrusted: true,
    });

    const result = await deepResearchResultCommand.func!(page, { query: 'A title' });

    expect(result).toEqual([{ response: 'Deep Research is still running. Please wait and retry later.' }]);
  });

  it('returns no-docs message when text indicates completed state', async () => {
    mockExportGeminiDeepResearchReport.mockResolvedValue({ url: '', source: 'none' });
    mockGetLatestGeminiAssistantResponse.mockResolvedValue('Research completed. Report completed.');
    mockReadGeminiSnapshot.mockResolvedValue({
      turns: [],
      transcriptLines: [],
      composerHasText: false,
      isGenerating: false,
      structuredTurnsTrusted: true,
    });

    const result = await deepResearchResultCommand.func!(page, { query: 'A title' });

    expect(result).toEqual([{ response: 'No Docs URL found. Please check Share & Export -> Export to Docs in Gemini UI.' }]);
  });

  it('maps in-progress text to waiting message (regression)', async () => {
    mockExportGeminiDeepResearchReport.mockResolvedValue({ url: '', source: 'none' });
    mockGetLatestGeminiAssistantResponse.mockResolvedValue('Research in progress. Gathering sources now.');

    const result = await deepResearchResultCommand.func!(page, { query: 'A title' });

    expect(result).toEqual([{ response: 'Deep Research is still running. Please wait and retry later.' }]);
  });

  it('maps completed text to no-docs message (regression)', async () => {
    mockExportGeminiDeepResearchReport.mockResolvedValue({ url: '', source: 'none' });
    mockGetLatestGeminiAssistantResponse.mockResolvedValue('Research is complete. Exporting should be available soon.');

    const result = await deepResearchResultCommand.func!(page, { query: 'A title' });

    expect(result).toEqual([{ response: 'No Docs URL found. Please check Share & Export -> Export to Docs in Gemini UI.' }]);
  });

  it('maps neutral text to pending message (regression)', async () => {
    mockExportGeminiDeepResearchReport.mockResolvedValue({ url: '', source: 'none' });
    mockGetLatestGeminiAssistantResponse.mockResolvedValue('Thanks for waiting while I check that.');

    const result = await deepResearchResultCommand.func!(page, { query: 'A title' });

    expect(result).toEqual([{ response: 'Deep Research may still be running or preparing export. Please wait and retry later.' }]);
  });

  it('does not treat negated completed text as completed (regression)', async () => {
    mockExportGeminiDeepResearchReport.mockResolvedValue({ url: '', source: 'none' });
    mockGetLatestGeminiAssistantResponse.mockResolvedValue('The research is not completed yet.');

    const result = await deepResearchResultCommand.func!(page, { query: 'A title' });

    expect(result).toEqual([{ response: 'Deep Research may still be running or preparing export. Please wait and retry later.' }]);
  });

  it('returns pending message when assistant response is empty', async () => {
    mockExportGeminiDeepResearchReport.mockResolvedValue({ url: '', source: 'none' });
    mockGetLatestGeminiAssistantResponse.mockResolvedValue('');

    const result = await deepResearchResultCommand.func!(page, { query: 'A title' });

    expect(result).toEqual([{ response: 'Deep Research may still be running or preparing export. Please wait and retry later.' }]);
  });
});
