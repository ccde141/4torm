import { Fragment } from 'react';
import ToolCallMessage from '../../../components/chat/ToolCallMessage';
import DelegateCard from '../../../components/chat/DelegateCard';
import AskCard from '../../../components/chat/AskCard';
import ContactCard from './ContactCard';
import CycloneToolActivityList from './CycloneToolActivityList';
import CycloneSystemToolCard from './CycloneSystemToolCard';
import { isCycloneSystemTool } from './cyclone-system-tool';
import type { DisplayBlock } from './messageDisplay';
import type { CycloneDispatch } from './dispatch-timeline';
import type { Live } from './useSeatStreamRunners';

function BlockRow({ block, dispatches, onAskReply }: {
  block: DisplayBlock;
  dispatches: CycloneDispatch[];
  onAskReply?: (answer: string) => void;
}) {
  if (block.kind === 'tool') {
    if (isCycloneSystemTool(block.tool)) {
      return <CycloneSystemToolCard block={block} dispatches={dispatches} />;
    }
    return <ToolCallMessage toolCall={{
      toolName: block.tool, params: block.args, result: block.result, status: block.status,
    }} />;
  }
  if (block.kind === 'delegate') {
    return <DelegateCard toolCall={{
      toolName: 'delegate', params: { task: block.task }, result: block.summary,
      status: block.status, steps: block.steps as any,
    }} content={block.content} />;
  }
  if (block.kind === 'ask') {
    return <AskCard question={block.question} options={block.options} answered={block.answered}
      reply={block.reply} onReply={onAskReply || (() => {})} />;
  }
  return <ContactCard data={{
    target: block.target, message: block.message, reply: block.reply, status: block.status,
  }} />;
}

export function BlockRows({ blocks, prefix, dispatches, onAskReply }: {
  blocks: DisplayBlock[];
  prefix: string;
  dispatches: CycloneDispatch[];
  onAskReply?: (answer: string) => void;
}) {
  const items = blocks.map(block => ({
    block,
    tool: block.kind === 'tool' ? block.tool : block.kind,
    status: 'status' in block ? block.status : undefined,
    args: block.kind === 'tool' ? block.args : undefined,
  }));
  return (
    <CycloneToolActivityList items={items} renderItem={(item, index) => (
      <BlockRow key={`${prefix}-${index}`} block={item.block} dispatches={dispatches}
        onAskReply={onAskReply} />
    )} />
  );
}

function AssistantTextBubble({ content, phase, streaming }: {
  content?: string;
  phase?: string;
  streaming?: boolean;
}) {
  if (!content && !phase) return null;
  return (
    <div className="chat__message chat__message--assistant">
      <div className="chat__avatar">AI</div>
      <div className="chat__bubble">
        {phase && <div className="chat__streaming-phase">{phase}</div>}
        {content && <div className="md-bubble" style={{ whiteSpace: 'pre-wrap' }}>{content}{streaming ? '▌' : ''}</div>}
      </div>
    </div>
  );
}

export function LiveReplySegments({ live, dispatches, onAskReply }: {
  live: Live;
  dispatches: CycloneDispatch[];
  onAskReply: (answer: string) => void;
}) {
  return <>{live.segments.map((segment, index) => {
    const last = index === live.segments.length - 1;
    return (
      <Fragment key={`live-${index}`}>
        <AssistantTextBubble content={segment.content}
          phase={last && segment.content ? live.phase : undefined}
          streaming={last && !!segment.content} />
        <BlockRows blocks={segment.blocks} prefix={`live-${index}`}
          dispatches={dispatches} onAskReply={onAskReply} />
        {last && !segment.content && <AssistantTextBubble phase={live.phase} />}
      </Fragment>
    );
  })}{live.segments.length === 0 && <AssistantTextBubble phase={live.phase} />}</>;
}
