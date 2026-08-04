import { z } from 'zod'
import fetch from 'node-fetch'
import { StructuredTool, ToolParams } from '@langchain/core/tools'

export const FIGMA_API_BASE_URL = 'https://api.figma.com'

export interface FigmaToolParams extends ToolParams {
    accessToken: string
    fileKey: string
}

interface FigmaColor {
    r: number
    g: number
    b: number
    a?: number
}

const toHex = (color: FigmaColor, opacity?: number): string => {
    const channel = (value: number) =>
        Math.round(value * 255)
            .toString(16)
            .padStart(2, '0')
    const alpha = opacity ?? color.a ?? 1
    const hex = `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
    return alpha < 1 ? `${hex}${channel(alpha)}` : hex
}

export class FigmaTool extends StructuredTool {
    static lc_name() {
        return 'FigmaTool'
    }

    schema = z.object({
        operation: z
            .enum(['get_file', 'get_nodes', 'get_comments', 'get_styles', 'get_components', 'get_design_tokens'])
            .describe(
                'The operation to perform: "get_design_tokens" extracts the design tokens (colors, typography, effects) and the component inventory of the file, ideal for applying a UI kit to generated prototypes. "get_file" retrieves the raw file document, "get_nodes" retrieves specific nodes, "get_comments" retrieves the comments left on the file, "get_styles" and "get_components" list the styles and components published from the file'
            ),
        nodeIds: z.string().optional().describe('Comma separated list of node IDs, required when operation is "get_nodes"'),
        depth: z.number().optional().describe('How many levels deep to traverse the document tree when operation is "get_file"')
    })

    name = 'figma'

    description =
        'Retrieve information from a Figma file. Useful to read a UI kit or design system and apply it to prototypes: extract design tokens (colors, typography, effects), list components, inspect the document and read comments'

    accessToken: string

    fileKey: string

    constructor({ accessToken, fileKey, ...rest }: FigmaToolParams) {
        super(rest)
        this.accessToken = accessToken
        this.fileKey = fileKey
    }

    async _call({ operation, nodeIds, depth }: z.infer<typeof this.schema>): Promise<string> {
        try {
            switch (operation) {
                case 'get_file': {
                    const params = new URLSearchParams()
                    if (depth) params.set('depth', String(depth))
                    const queryString = params.toString()
                    return await this.fetchFigma(`/v1/files/${this.fileKey}${queryString ? `?${queryString}` : ''}`)
                }
                case 'get_nodes': {
                    if (!nodeIds) return 'Error: nodeIds is required for the "get_nodes" operation'
                    const ids = nodeIds
                        .split(',')
                        .map((id) => id.trim())
                        .filter((id) => id.length)
                        .join(',')
                    return await this.fetchFigma(`/v1/files/${this.fileKey}/nodes?ids=${encodeURIComponent(ids)}`)
                }
                case 'get_comments':
                    return await this.fetchFigma(`/v1/files/${this.fileKey}/comments`)
                case 'get_styles':
                    return await this.fetchFigma(`/v1/files/${this.fileKey}/styles`)
                case 'get_components':
                    return await this.fetchFigma(`/v1/files/${this.fileKey}/components`)
                case 'get_design_tokens':
                    return await this.getDesignTokens()
            }
        } catch (error) {
            return `Error: failed to call Figma API: ${error}`
        }
    }

    async fetchFigma(path: string): Promise<string> {
        const response = await fetch(`${FIGMA_API_BASE_URL}${path}`, {
            headers: {
                'X-Figma-Token': this.accessToken
            }
        })
        const body = await response.text()
        if (!response.ok) {
            return `Error: Figma API request failed with status ${response.status}: ${body}`
        }
        return body
    }

    /**
     * Walks the entire file once and resolves every style referenced in the
     * document to its concrete values, producing a compact summary that fits
     * in an LLM context even for large UI kit files.
     */
    async getDesignTokens(): Promise<string> {
        const body = await this.fetchFigma(`/v1/files/${this.fileKey}`)
        if (body.startsWith('Error:')) return body
        const file = JSON.parse(body)

        // first node found using each styleId provides the style's concrete values
        const styleUsages = new Map<string, ICommonNode>()
        const collectStyleUsages = (node: ICommonNode) => {
            if (node.styles) {
                for (const styleId of Object.values(node.styles)) {
                    if (typeof styleId === 'string' && !styleUsages.has(styleId)) styleUsages.set(styleId, node)
                }
            }
            if (Array.isArray(node.children)) node.children.forEach(collectStyleUsages)
        }
        collectStyleUsages(file.document)

        const colors: ICommonObject[] = []
        const typography: ICommonObject[] = []
        const effects: ICommonObject[] = []
        for (const [styleId, style] of Object.entries<any>(file.styles ?? {})) {
            const node = styleUsages.get(styleId)
            if (!node) continue
            if (style.styleType === 'FILL') {
                const solidFills = (node.fills ?? []).filter((fill: any) => fill.type === 'SOLID' && fill.color)
                if (solidFills.length) {
                    colors.push({
                        name: style.name,
                        value: toHex(solidFills[0].color, solidFills[0].opacity)
                    })
                }
            } else if (style.styleType === 'TEXT' && node.style) {
                typography.push({
                    name: style.name,
                    fontFamily: node.style.fontFamily,
                    fontWeight: node.style.fontWeight,
                    fontSize: node.style.fontSize,
                    lineHeight: node.style.lineHeightPx,
                    letterSpacing: node.style.letterSpacing
                })
            } else if (style.styleType === 'EFFECT' && Array.isArray(node.effects)) {
                effects.push({
                    name: style.name,
                    effects: node.effects.map((effect: any) => ({
                        type: effect.type,
                        color: effect.color ? toHex(effect.color) : undefined,
                        offset: effect.offset,
                        radius: effect.radius,
                        spread: effect.spread
                    }))
                })
            }
        }

        const components = Object.values<any>(file.components ?? {}).map((component) => ({
            name: component.name,
            description: component.description || undefined
        }))

        return JSON.stringify({ name: file.name, colors, typography, effects, components })
    }
}

interface ICommonObject {
    [key: string]: any
}

interface ICommonNode extends ICommonObject {
    children?: ICommonNode[]
}
