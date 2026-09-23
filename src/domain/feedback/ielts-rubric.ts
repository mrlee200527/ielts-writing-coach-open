// Official IELTS Writing Band Descriptors (Band 6/7/8) for Instant Check v3 coaching.
// Derived from docs/references/official/ielts/band-descriptors-extract.md, extracted from
// docs/references/official/ielts/ielts-writing-band-descriptors.pdf
// (SHA-256 E3C88943EF92D98988CE4DB454FD7FA8D8435F0B25E9EC667E3720A5C1168D1B).
// Official descriptors define whole bands only (9/8/7/6/...); there is NO official 6.5/7.5 descriptor.

export const targetBands = ["6.0", "6.5", "7.0", "7.5"] as const;
export type TargetBand = (typeof targetBands)[number];
export type TaskKindForRubric = "TASK_1" | "TASK_2";

/** Target band -> official whole-band thresholds used for coaching. */
export const targetBandThresholds: Record<TargetBand, readonly number[]> = {
  "6.0": [6],
  "6.5": [6, 7],
  "7.0": [7],
  "7.5": [7, 8],
};

type Criteria = {
  first: string;
  coherence: string;
  lexical: string;
  grammatical: string;
};

const task1Criteria: Record<number, Criteria> = {
  6: {
    first: "Task Achievement: The response focuses on the requirements of the task and an appropriate format is used. (Academic) Key features which are selected are covered and adequately highlighted. A relevant overview is attempted. Information is appropriately selected and supported using figures/data. Some irrelevant, inappropriate or inaccurate information may occur in areas of detail or when illustrating or extending the main points. Some details may be missing (or excessive) and further extension or illustration may be needed.",
    coherence: "Coherence & Cohesion: Information and ideas are generally arranged coherently and there is a clear overall progression. Cohesive devices are used to some good effect but cohesion within and/or between sentences may be faulty or mechanical due to misuse, overuse or omission. The use of reference and substitution may lack flexibility or clarity and result in some repetition or error.",
    lexical: "Lexical Resource: The resource is generally adequate and appropriate for the task. The meaning is generally clear in spite of a rather restricted range or a lack of precision in word choice. If the writer is a risk-taker, there will be a wider range of vocabulary used but higher degrees of inaccuracy or inappropriacy. There are some errors in spelling and/or word formation, but these do not impede communication.",
    grammatical: "Grammatical Range & Accuracy: A mix of simple and complex sentence forms is used but flexibility is limited. Examples of more complex structures are not marked by the same level of accuracy as in simple structures. Errors in grammar and punctuation occur, but rarely impede communication.",
  },
  7: {
    first: "Task Achievement: The response covers the requirements of the task. The content is relevant and accurate \u2013 there may be a few omissions or lapses. The format is appropriate. (Academic) Key features which are selected are covered and clearly highlighted but could be more fully or more appropriately illustrated or extended. (Academic) It presents a clear overview, the data are appropriately categorised, and main trends or differences are identified.",
    coherence: "Coherence & Cohesion: Information and ideas are logically organised and there is a clear progression throughout the response. A few lapses may occur. A range of cohesive devices including reference and substitution is used flexibly but with some inaccuracies or some over/under use.",
    lexical: "Lexical Resource: The resource is sufficient to allow some flexibility and precision. There is some ability to use less common and/or idiomatic items. An awareness of style and collocation is evident, though inappropriacies occur. There are only a few errors in spelling and/or word formation, and they do not detract from overall clarity.",
    grammatical: "Grammatical Range & Accuracy: A variety of complex structures is used with some flexibility and accuracy. Grammar and punctuation are generally well controlled, and error-free sentences are frequent. A few errors in grammar may persist, but these do not impede communication.",
  },
  8: {
    first: "Task Achievement: The response covers all the requirements of the task appropriately, relevantly and sufficiently. (Academic) Key features are skilfully selected, and clearly presented, highlighted and illustrated. (General Training) All bullet points are clearly presented, and appropriately illustrated or extended. There may be occasional omissions or lapses in content.",
    coherence: "Coherence & Cohesion: The message can be followed with ease. Information and ideas are logically sequenced, and cohesion is well managed. Occasional lapses in coherence or cohesion may occur. Paragraphing is used sufficiently and appropriately.",
    lexical: "Lexical Resource: A wide resource is fluently and flexibly used to convey precise meanings within the scope of the task. There is skilful use of uncommon and/or idiomatic items when appropriate, despite occasional inaccuracies in word choice and collocation. Occasional errors in spelling and/or word formation may occur, but have minimal impact on communication.",
    grammatical: "Grammatical Range & Accuracy: A wide range of structures within the scope of the task is flexibly and accurately used. The majority of sentences are error-free, and punctuation is well managed. Occasional, non-systematic errors and inappropriacies occur, but have minimal impact on communication.",
  },
};

const task2Criteria: Record<number, Criteria> = {
  6: {
    first: "Task Response: The main parts of the prompt are addressed (though some may be more fully covered than others). An appropriate format is used. A position is presented that is directly relevant to the prompt, although the conclusions drawn may be unclear, unjustified or repetitive. Main ideas are relevant, but some may be insufficiently developed or may lack clarity, while some supporting arguments and evidence may be less relevant or inadequate.",
    coherence: "Coherence & Cohesion: Information and ideas are generally arranged coherently and there is a clear overall progression. Cohesive devices are used to some good effect but cohesion within and/or between sentences may be faulty or mechanical due to misuse, overuse or omission. The use of reference and substitution may lack flexibility or clarity and result in some repetition or error. Paragraphing may not always be logical and/or the central topic may not always be clear.",
    lexical: "Lexical Resource: The resource is generally adequate and appropriate for the task. The meaning is generally clear in spite of a rather restricted range or a lack of precision in word choice. If the writer is a risk-taker, there will be a wider range of vocabulary used but higher degrees of inaccuracy or inappropriacy. There are some errors in spelling and/or word formation, but these do not impede communication.",
    grammatical: "Grammatical Range & Accuracy: A mix of simple and complex sentence forms is used but flexibility is limited. Examples of more complex structures are not marked by the same level of accuracy as in simple structures. Errors in grammar and punctuation occur, but rarely impede communication.",
  },
  7: {
    first: "Task Response: The main parts of the prompt are appropriately addressed. A clear and developed position is presented. Main ideas are extended and supported but there may be a tendency to over-generalise or there may be a lack of focus and precision in supporting ideas/material.",
    coherence: "Coherence & Cohesion: Information and ideas are logically organised, and there is a clear progression throughout the response. (A few lapses may occur, but these are minor.) A range of cohesive devices including reference and substitution is used flexibly but with some inaccuracies or some over/under use. Paragraphing is generally used effectively to support overall coherence, and the sequencing of ideas within a paragraph is generally logical.",
    lexical: "Lexical Resource: The resource is sufficient to allow some flexibility and precision. There is some ability to use less common and/or idiomatic items. An awareness of style and collocation is evident, though inappropriacies occur. There are only a few errors in spelling and/or word formation and they do not detract from overall clarity.",
    grammatical: "Grammatical Range & Accuracy: A variety of complex structures is used with some flexibility and accuracy. Grammar and punctuation are generally well controlled, and error-free sentences are frequent. A few errors in grammar may persist, but these do not impede communication.",
  },
  8: {
    first: "Task Response: The prompt is appropriately and sufficiently addressed. A clear and well-developed position is presented in response to the question/s. Ideas are relevant, well extended and supported. There may be occasional omissions or lapses in content.",
    coherence: "Coherence & Cohesion: The message can be followed with ease. Information and ideas are logically sequenced, and cohesion is well managed. Occasional lapses in coherence and cohesion may occur. Paragraphing is used sufficiently and appropriately.",
    lexical: "Lexical Resource: A wide resource is fluently and flexibly used to convey precise meanings. There is skilful use of uncommon and/or idiomatic items when appropriate, despite occasional inaccuracies in word choice and collocation. Occasional errors in spelling and/or word formation may occur, but have minimal impact on communication.",
    grammatical: "Grammatical Range & Accuracy: A wide range of structures is flexibly and accurately used. The majority of sentences are error-free, and punctuation is well managed. Occasional, non-systematic errors and inappropriacies occur, but have minimal impact on communication.",
  },
};

export function buildOfficialRubricContext(taskType: TaskKindForRubric, targetBand: TargetBand): string {
  const criteria = taskType === "TASK_1" ? task1Criteria : task2Criteria;
  const bands = targetBandThresholds[targetBand];
  const sections = bands.map((band) => {
    const entry = criteria[band];
    const lines = [
      `Band ${band}:`,
      `- ${entry.first}`,
      `- ${entry.coherence}`,
      `- ${entry.lexical}`,
      `- ${entry.grammatical}`,
    ];
    return lines.join("\n");
  });
  return sections.join("\n\n");
}
