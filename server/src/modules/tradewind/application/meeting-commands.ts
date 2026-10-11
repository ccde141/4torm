export interface MeetingParticipantView {
  nodeId: string;
  agentId: string;
  label: string;
}

export interface MeetingIdentity {
  executionId: string;
  nodeId: string;
}

export interface MeetingParticipantCommand extends MeetingIdentity {
  participantNodeId: string;
}

export interface MeetingOrderCommand extends MeetingIdentity {
  order: string[];
}

export interface MeetingMessageCommand extends MeetingIdentity {
  message: string;
}

export interface TradewindMeetingCommands {
  end(input: MeetingIdentity): Promise<{ minutes: string }>;
  join(input: MeetingParticipantCommand): Promise<{ participants: MeetingParticipantView[] }>;
  leave(input: MeetingParticipantCommand): Promise<{ participants: MeetingParticipantView[] }>;
  reorder(input: MeetingOrderCommand): Promise<{ participants: MeetingParticipantView[] }>;
  speak(input: MeetingMessageCommand): Promise<{ completed: true; nodeId: string; runId: string }>;
  messageChair(input: MeetingMessageCommand): Promise<{ completed: true; nodeId: string }>;
}
