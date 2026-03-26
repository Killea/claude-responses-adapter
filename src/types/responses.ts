export interface ResponsesMessageInput {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface ResponsesTextInputContent {
    type: 'input_text';
    text: string;
}

export interface ResponsesImageInputContent {
    type: 'input_image';
    image_url: string;
    detail?: 'low' | 'high' | 'auto';
}

export type ResponsesContentInput = ResponsesTextInputContent | ResponsesImageInputContent;

export interface ResponsesMultimodalMessageInput {
    role: 'user' | 'assistant' | 'system';
    content: ResponsesContentInput[];
}

export interface ResponsesFunctionCallInputItem {
    type: 'function_call';
    call_id: string;
    name: string;
    arguments: string;
    id?: string;
}

export interface ResponsesFunctionCallOutputInputItem {
    type: 'function_call_output';
    call_id: string;
    output: string;
}

export type ResponsesInputItem =
    | ResponsesMessageInput
    | ResponsesMultimodalMessageInput
    | ResponsesFunctionCallInputItem
    | ResponsesFunctionCallOutputInputItem;

export interface ResponsesTool {
    type: 'function';
    name: string;
    description?: string;
    parameters: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}

export type ResponsesToolChoice =
    | 'auto'
    | 'required'
    | 'none'
    | { type: 'function'; name: string };

export interface ResponsesCreateRequest {
    model: string;
    input: ResponsesInputItem[];
    instructions?: string;
    max_output_tokens?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    stream?: boolean;
    tools?: ResponsesTool[];
    tool_choice?: ResponsesToolChoice;
    stop?: string[];
    user?: string;
}

export interface ResponsesOutputText {
    type: 'output_text' | 'text';
    text: string;
}

export interface ResponsesMessageOutputItem {
    type: 'message';
    id?: string;
    role: 'assistant';
    content: ResponsesOutputText[];
}

export interface ResponsesFunctionCallOutputItem {
    type: 'function_call';
    id?: string;
    call_id: string;
    name: string;
    arguments: string;
}

export type ResponsesOutputItem =
    | ResponsesMessageOutputItem
    | ResponsesFunctionCallOutputItem;

export interface ResponsesUsage {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: {
        cached_tokens?: number;
    };
}

export interface ResponsesIncompleteDetails {
    reason?: string;
    stop_sequence?: string | null;
}

export interface ResponsesResponse {
    id: string;
    object?: string;
    model: string;
    status?: string;
    output?: ResponsesOutputItem[];
    usage?: ResponsesUsage;
    incomplete_details?: ResponsesIncompleteDetails;
    error?: {
        message?: string;
    };
}

export interface ResponsesErrorResponse {
    error?: {
        message?: string;
        type?: string;
    };
}

export interface ResponsesFunctionCallStreamItem {
    type: 'function_call';
    id?: string;
    call_id: string;
    name: string;
}

export interface ResponsesStreamEvent {
    type: string;
    delta?: string;
    output_index?: number;
    item_id?: string;
    item?: ResponsesFunctionCallStreamItem;
    response?: ResponsesResponse;
    error?: {
        message?: string;
    };
    sequence_number?: number;
}
