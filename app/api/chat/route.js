import {NextResponse} from "next/server"
import {Pinecone} from "@pinecone-database/pinecone"
import OpenAI from "openai"

const systemPrompt = `
You are a rate my professor agent to help students find classes, that takes in user questions and answers them.
For every user question, the top 3 professors that match the user question are returned.
Use them to answer the question if needed.
`

export async function POST(req) {
    const data = await req.json()
    const pc = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY
    })
    const index = pc.Index('rag').namespace('UDCS2')
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    })
    const text = data[data.length -1].content
    const embedding = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        encoding_format: 'float'
    })
    const results = await index.query({
        topK: 26,
        includeMetadata: true,
        vector: embedding.data[0].embedding
    })
    let resultString = ''
    results.matches.forEach((match) => {
        resultString += `
        Returned Results:
        Professor: ${match.id}
        Review: ${match.metadata.reviews}
        Average Grade: ${match.metadata.average_grade}
        Rating: ${match.metadata.rating}
        Difficulty: ${match.metadata.difficulty}
        Courses: ${match.metadata.courses}
        \n\n
        `
    })
    const lastMessage = data[data.length - 1]
    const lastMessageContent = lastMessage.content + resultString
    const lastDataWithoutLastMessage = data.slice(0, data.length - 1)
    const completions = await openai.chat.completions.create({
        messages : [
            {role: 'system', content: systemPrompt},
            ...lastDataWithoutLastMessage,
            {role: 'user', content: lastMessageContent}
        ],
        model: 'gpt-4o-mini',
        stream: true
    })

    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder()
            try{
                for await (const chunk of completions) {
                    const content = chunk.choices[0]?.delta?.content
                    if (content) {
                        const text = encoder.encode(content)
                        controller.enqueue(text)
                    }
                }
            }catch (error) {
                controller.error(error)

            }finally {
                controller.close()
            }
        }
    })

    return new NextResponse(stream)

}
