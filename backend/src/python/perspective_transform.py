import sys
import json
import cv2
import numpy as np

def perspective_transform(image_path, corners, output_path):
	## 이미지에 투영 변환을 적용합니다.

	## Args:
	## image_path: 원본 이미지 경로
	## corners: 네 모서리 좌표 리스트 [{"x": float, "y": float}, …]
	##output_path: 결과 이미지 저장 경로

	# 이미지 로드
	img = cv2.imread(image_path)
	if img is None:
		raise ValueError(f"이미지를 불러올 수 없습니다: {image_path}")

	# 원본 좌표 (사용자가 찍은 네 점)
	src_points = np.float32([
		[corners[0]['x'], corners[0]['y']],
		[corners[1]['x'], corners[1]['y']],
		[corners[2]['x'], corners[2]['y']],
		[corners[3]['x'], corners[3]['y']]
	])

	# 목표 좌표 (정면 직사각형)
	width = 1050
	height = 1400
	dst_points = np.float32([
		[0, 0],
		[width, 0],
		[width, height],
		[0, height]
	])

	# 변환 행렬 계산
	matrix = cv2.getPerspectiveTransform(src_points, dst_points)

	# 투영 변환 적용
	result = cv2.warpPerspective(img, matrix, (width, height))

	# 결과 저장
	cv2.imwrite(output_path, result)

	return output_path
if __name__ == "__main__":
	print(f"DEBUG: sys.argv length = {len(sys.argv)}", file=sys.stderr)
	print(f"DEBUG: sys.argv = {sys.argv}", file=sys.stderr)
	if len(sys.argv) != 4:
		print(json.dumps({"success": False, "error": "Usage: python perspective_transform.py <image_path> <corners_json> <output_path>"}))
		sys.exit(1)

	image_path = sys.argv[1]
	corners_json = sys.argv[2]
	output_path = sys.argv[3]

try:
	# JSON 파일 읽기
	with open(corners_json, 'r', encoding='utf-8') as f:
		corners = json.load(f)
	print(f"DEBUG: corners parsed = {corners}", file=sys.stderr)
	result_path = perspective_transform(image_path, corners, output_path)
	print(json.dumps({"success": True, "output": result_path}))
except Exception as e:
	print(json.dumps({"success": False, "error": str(e)}))
	sys.exit(1)
