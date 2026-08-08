import ToolCallMessage from '../../../components/chat/ToolCallMessage';
import DelegateCard from '../../../components/chat/DelegateCard';
import AskCard from '../../../components/chat/AskCard';
import ContactCard from './ContactCard';
import CycloneToolActivityList from './CycloneToolActivityList';
import CycloneSystemToolCard from './CycloneSystemToolCard';
import { isCycloneSystemTool } from './cyclone-system-tool';
import type { DisplayBlock } from './messageDisplay';
import type { CycloneDispatch } from './dispatch-timeline';

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
