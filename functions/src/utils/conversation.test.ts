import { describe, it, expect } from 'vitest';
import { formatHistory } from './conversation.js';
import type { ConversationTurn } from '../types/index.js';

describe('formatHistory', () => {
  it('空配列を渡すと空文字列を返す', () => {
    expect(formatHistory([])).toBe('');
  });

  it('各ターンを [名前(役割)]: 内容 の形式に変換する', () => {
    const history: ConversationTurn[] = [
      { turnId: 't1', turnIndex: 0, speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '司会', content: '討論を始めます。' },
    ];
    expect(formatHistory(history)).toBe('[ファシリテーター(司会)]: 討論を始めます。');
  });

  it('複数のターンを改行で結合する', () => {
    const history: ConversationTurn[] = [
      { turnId: 't1', turnIndex: 0, speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '司会', content: '開会します。' },
      { turnId: 't2', turnIndex: 1, speakerType: 'persona', speakerName: '田中太郎', speakerRole: '医師', content: '賛成です。' },
    ];
    const result = formatHistory(history);
    expect(result).toBe('[ファシリテーター(司会)]: 開会します。\n[田中太郎(医師)]: 賛成です。');
  });
});
