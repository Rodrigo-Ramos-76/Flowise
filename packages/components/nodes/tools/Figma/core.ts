import { z } from 'zod'
import fetch from 'node-fetch'
import { StructuredTool, ToolParams } from '@langchain/core/tools'

export const FIGMA_API_BASE_URL = 'https://api.figma.com'

export interface FigmaToolParams extends ToolParams {
    accessToken: string
    fileKey: string
}

export class FigmaTool extends StructuredTool {
    static lc_name() {
        return 'FigmaTool'
    }

    schema = z.object({
        operation: z
            .enum(['get_file', 'get_nodes', 'get_comments'])
            .describe(
                'The operation to perform: "get_file" retrieves the file document, "get_nodes" retrieves specific nodes, "get_comments" retrieves the comments left on the file'
            ),
        nodeIds: z.string().optional().describe('Comma separated list of node IDs, required when operation is "get_nodes"'),
        depth: z.number().optional().describe('How many levels deep to traverse the document tree when operation is "get_file"')
    })

    name = 'figma'

    description = 'Retrieve information from a Figma file. Useful to inspect designs: document structure, specific nodes and comments'

    accessToken: string

    fileKey: string

    constructor({ accessToken, fileKey, ...rest }: FigmaToolParams) {
        super(rest)
        this.accessToken = accessToken
        this.fileKey = fileKey
    }

    async _call({ operation, nodeIds, depth }: z.infer<typeof this.schema>): Promise<string> {
        let url: string
        switch (operation) {
            case 'get_file': {
                const params = new URLSearchParams()
                if (depth) params.set('depth', String(depth))
                const queryString = params.toString()
                url = `${FIGMA_API_BASE_URL}/v1/files/${this.fileKey}${queryString ? `?${queryString}` : ''}`
                break
            }
            case 'get_nodes': {
                if (!nodeIds) return 'Error: nodeIds is required for the "get_nodes" operation'
                const ids = nodeIds
                    .split(',')
                    .map((id) => id.trim())
                    .filter((id) => id.length)
                    .join(',')
                url = `${FIGMA_API_BASE_URL}/v1/files/${this.fileKey}/nodes?ids=${encodeURIComponent(ids)}`
                break
            }
            case 'get_comments':
                url = `${FIGMA_API_BASE_URL}/v1/files/${this.fileKey}/comments`
                break
        }

        try {
            const response = await fetch(url, {
                headers: {
                    'X-Figma-Token': this.accessToken
                }
            })
            const body = await response.text()
            if (!response.ok) {
                return `Error: Figma API request failed with status ${response.status}: ${body}`
            }
            return body
        } catch (error) {
            return `Error: failed to call Figma API: ${error}`
        }
    }
}
