import AppKit
import CoreGraphics
import Foundation
import Vision

struct OCRBox: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct OCRObservation: Codable {
    let text: String
    let confidence: Double
    let box: OCRBox
}

struct OCRResponse: Codable {
    let ok: Bool
    let observations: [OCRObservation]
    let coordinateSystem: String
    let error: String?
}

func emit(_ response: OCRResponse, exitCode: Int32 = 0) -> Never {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    do {
        let data = try encoder.encode(response)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    } catch {
        FileHandle.standardError.write(Data("Apple Vision OCR JSON encoding failed: \(error)\n".utf8))
    }
    exit(exitCode)
}

guard CommandLine.arguments.count == 2 else {
    emit(
        OCRResponse(
            ok: false,
            observations: [],
            coordinateSystem: "vision_normalized_bottom_left",
            error: "usage: apple-vision-ocr <image-path>"
        ),
        exitCode: 64
    )
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: imageURL) else {
    emit(
        OCRResponse(
            ok: false,
            observations: [],
            coordinateSystem: "vision_normalized_bottom_left",
            error: "image could not be opened"
        ),
        exitCode: 65
    )
}

var proposedRect = CGRect(origin: .zero, size: image.size)
guard let cgImage = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
    emit(
        OCRResponse(
            ok: false,
            observations: [],
            coordinateSystem: "vision_normalized_bottom_left",
            error: "image could not be converted to CGImage"
        ),
        exitCode: 66
    )
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.minimumTextHeight = 0.006
request.recognitionLanguages = ["en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    emit(
        OCRResponse(
            ok: false,
            observations: [],
            coordinateSystem: "vision_normalized_bottom_left",
            error: "Vision request failed: \(error)"
        ),
        exitCode: 67
    )
}

let observations: [OCRObservation] = (request.results ?? []).compactMap { observation in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return nil }
    let box = observation.boundingBox
    return OCRObservation(
        text: text,
        confidence: Double(candidate.confidence),
        box: OCRBox(
            x: Double(box.origin.x),
            y: Double(box.origin.y),
            width: Double(box.size.width),
            height: Double(box.size.height)
        )
    )
}

emit(
    OCRResponse(
        ok: true,
        observations: observations,
        coordinateSystem: "vision_normalized_bottom_left",
        error: nil
    )
)
