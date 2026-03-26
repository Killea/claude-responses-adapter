// Request validation utilities

export interface ValidationError {
    field: string;
    message: string;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

function validateToolDefinition(tool: Record<string, unknown>, index: number): ValidationError[] {
    const errors: ValidationError[] = [];

    if (typeof tool.name !== 'string' || tool.name.length === 0) {
        errors.push({ field: `tools[${index}].name`, message: 'tool name is required and must be a string' });
    }

    if (typeof tool.description !== 'string') {
        errors.push({ field: `tools[${index}].description`, message: 'tool description is required and must be a string' });
    }

    const schema = tool.input_schema;
    if (!schema || typeof schema !== 'object') {
        errors.push({ field: `tools[${index}].input_schema`, message: 'tool input_schema is required and must be an object' });
    }

    return errors;
}

function validateToolChoice(toolChoice: Record<string, unknown>): ValidationError[] {
    const errors: ValidationError[] = [];
    const type = toolChoice.type;

    if (!['auto', 'any', 'tool'].includes(String(type))) {
        errors.push({ field: 'tool_choice.type', message: 'tool_choice.type must be one of auto, any, or tool' });
    }

    if (type === 'tool' && typeof toolChoice.name !== 'string') {
        errors.push({ field: 'tool_choice.name', message: 'tool_choice.name is required when type is tool' });
    }

    return errors;
}

function validateContentBlockShape(contentBlock: Record<string, unknown>, fieldPrefix: string): ValidationError[] {
    const errors: ValidationError[] = [];

    switch (contentBlock.type) {
        case 'text':
            if (typeof contentBlock.text !== 'string') {
                errors.push({ field: `${fieldPrefix}.text`, message: 'text block must include text string' });
            }
            break;
        case 'tool_use':
            if (typeof contentBlock.id !== 'string') {
                errors.push({ field: `${fieldPrefix}.id`, message: 'tool_use block must include id string' });
            }
            if (typeof contentBlock.name !== 'string') {
                errors.push({ field: `${fieldPrefix}.name`, message: 'tool_use block must include name string' });
            }
            if (!('input' in contentBlock) || typeof contentBlock.input !== 'object' || contentBlock.input === null) {
                errors.push({ field: `${fieldPrefix}.input`, message: 'tool_use block must include input object' });
            }
            break;
        case 'tool_result':
            if (typeof contentBlock.tool_use_id !== 'string') {
                errors.push({ field: `${fieldPrefix}.tool_use_id`, message: 'tool_result block must include tool_use_id string' });
            }
            if (typeof contentBlock.content !== 'string' && !Array.isArray(contentBlock.content)) {
                errors.push({ field: `${fieldPrefix}.content`, message: 'tool_result block content must be string or array' });
            }
            break;
        case 'image':
            if (!contentBlock.source || typeof contentBlock.source !== 'object') {
                errors.push({ field: `${fieldPrefix}.source`, message: 'image block must include source object' });
                break;
            }
            break;
        default:
            errors.push({ field: `${fieldPrefix}.type`, message: `unsupported content block type: ${String(contentBlock.type)}` });
            break;
    }

    return errors;
}

function validateSystem(system: unknown): ValidationError[] {
    const errors: ValidationError[] = [];

    if (system === undefined) {
        return errors;
    }

    if (typeof system !== 'string' && !Array.isArray(system)) {
        errors.push({ field: 'system', message: 'system must be a string or array of text blocks' });
        return errors;
    }

    if (!Array.isArray(system)) {
        return errors;
    }

    for (let i = 0; i < system.length; i++) {
        const entry = system[i] as Record<string, unknown>;
        if (!entry || typeof entry !== 'object') {
            errors.push({ field: `system[${i}]`, message: 'system entry must be an object' });
            continue;
        }
        if (entry.type !== 'text') {
            errors.push({ field: `system[${i}].type`, message: 'system entry type must be "text"' });
        }
        if (typeof entry.text !== 'string') {
            errors.push({ field: `system[${i}].text`, message: 'system entry text must be a string' });
        }
    }

    return errors;
}

function validateContentBlocks(blocks: unknown[], messageIndex: number): ValidationError[] {
    const errors: ValidationError[] = [];

    for (let j = 0; j < blocks.length; j++) {
        const block = blocks[j];

        if (!block || typeof block !== 'object') {
            errors.push({
                field: `messages[${messageIndex}].content[${j}]`,
                message: 'content block must be an object'
            });
            continue;
        }

        const contentBlock = block as Record<string, unknown>;

        if (!contentBlock.type || typeof contentBlock.type !== 'string') {
            errors.push({
                field: `messages[${messageIndex}].content[${j}].type`,
                message: 'content block type is required'
            });
            continue;
        }

        errors.push(...validateContentBlockShape(contentBlock, `messages[${messageIndex}].content[${j}]`));
    }

    return errors;
}

function validateMessages(messages: unknown[]): ValidationError[] {
    const errors: ValidationError[] = [];

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        if (!msg || typeof msg !== 'object') {
            errors.push({ field: `messages[${i}]`, message: 'message must be an object' });
            continue;
        }

        const message = msg as Record<string, unknown>;

        if (!message.role || typeof message.role !== 'string') {
            errors.push({ field: `messages[${i}].role`, message: 'role is required and must be a string' });
        } else if (!['user', 'assistant'].includes(message.role)) {
            errors.push({ field: `messages[${i}].role`, message: 'role must be "user" or "assistant"' });
        }

        if (message.content === undefined || message.content === null) {
            errors.push({ field: `messages[${i}].content`, message: 'content is required' });
        } else if (typeof message.content !== 'string' && !Array.isArray(message.content)) {
            errors.push({ field: `messages[${i}].content`, message: 'content must be a string or array' });
        } else if (Array.isArray(message.content)) {
            errors.push(...validateContentBlocks(message.content, i));
        }
    }

    return errors;
}

function validateTools(tools: unknown): ValidationError[] {
    if (tools === undefined) {
        return [];
    }

    if (!Array.isArray(tools)) {
        return [{ field: 'tools', message: 'tools must be an array' }];
    }

    const errors: ValidationError[] = [];
    for (let i = 0; i < tools.length; i++) {
        const tool = tools[i];
        if (!tool || typeof tool !== 'object') {
            errors.push({ field: `tools[${i}]`, message: 'tool must be an object' });
            continue;
        }

        errors.push(...validateToolDefinition(tool as Record<string, unknown>, i));
    }

    return errors;
}

function validateRequestShape(request: Record<string, unknown>): ValidationError[] {
    const errors: ValidationError[] = [];

    if (request.temperature !== undefined) {
        if (typeof request.temperature !== 'number' || request.temperature < 0 || request.temperature > 1) {
            errors.push({ field: 'temperature', message: 'temperature must be a number between 0 and 1' });
        }
    }

    if (request.top_p !== undefined) {
        if (typeof request.top_p !== 'number' || request.top_p < 0 || request.top_p > 1) {
            errors.push({ field: 'top_p', message: 'top_p must be a number between 0 and 1' });
        }
    }

    if (request.stream !== undefined && typeof request.stream !== 'boolean') {
        errors.push({ field: 'stream', message: 'stream must be a boolean' });
    }

    errors.push(...validateSystem(request.system));
    errors.push(...validateTools(request.tools));

    if (request.tool_choice !== undefined) {
        if (!request.tool_choice || typeof request.tool_choice !== 'object') {
            errors.push({ field: 'tool_choice', message: 'tool_choice must be an object' });
        } else {
            errors.push(...validateToolChoice(request.tool_choice as Record<string, unknown>));
        }
    }

    return errors;
}

export function validateAnthropicRequest(body: unknown): ValidationResult {
    const errors: ValidationError[] = [];

    if (!body || typeof body !== 'object') {
        return { valid: false, errors: [{ field: 'body', message: 'Request body must be an object' }] };
    }

    const request = body as Record<string, unknown>;

    if (!request.model || typeof request.model !== 'string') {
        errors.push({ field: 'model', message: 'model is required and must be a string' });
    }

    if (request.max_tokens === undefined || typeof request.max_tokens !== 'number') {
        errors.push({ field: 'max_tokens', message: 'max_tokens is required and must be a number' });
    } else if (request.max_tokens <= 0) {
        errors.push({ field: 'max_tokens', message: 'max_tokens must be a positive number' });
    }

    if (!request.messages) {
        errors.push({ field: 'messages', message: 'messages is required' });
    } else if (!Array.isArray(request.messages)) {
        errors.push({ field: 'messages', message: 'messages must be an array' });
    } else if (request.messages.length === 0) {
        errors.push({ field: 'messages', message: 'messages array cannot be empty' });
    } else {
        errors.push(...validateMessages(request.messages));
    }

    errors.push(...validateRequestShape(request));

    return { valid: errors.length === 0, errors };
}

export function formatValidationErrors(errors: ValidationError[]): string {
    return errors.map(e => `${e.field}: ${e.message}`).join('; ');
}
