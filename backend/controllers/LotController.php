<?php
require_once __DIR__ . '/../models/Section.php';
require_once __DIR__ . '/../models/Block.php';
require_once __DIR__ . '/../models/Lot.php';

class LotController {
    private $sectionModel;
    private $blockModel;
    private $lotModel;

    public function __construct() {
        $this->sectionModel = new Section();
        $this->blockModel = new Block();
        $this->lotModel = new Lot();
    }

    public function getSections() {
        return $this->sectionModel->findAll();
    }

    public function getSection($id) {
        $section = $this->sectionModel->findById($id);
        return $section ?: ['error' => 'Section not found', 'code' => 404];
    }

    public function createSection($data) {
        if (empty($data['section_name'])) {
            return ['error' => 'Section name is required', 'code' => 400];
        }
        $result = $this->sectionModel->create($data);
        return $result ? ['success' => true, 'message' => 'Section created'] : ['error' => 'Failed to create section', 'code' => 500];
    }

    public function updateSection($id, $data) {
        if (empty($data['section_name'])) {
            return ['error' => 'Section name is required', 'code' => 400];
        }
        $result = $this->sectionModel->update($id, $data);
        return $result ? ['success' => true, 'message' => 'Section updated'] : ['error' => 'Failed to update section', 'code' => 500];
    }

    public function deleteSection($id) {
        $result = $this->sectionModel->delete($id);
        return $result ? ['success' => true, 'message' => 'Section deleted'] : ['error' => 'Failed to delete section', 'code' => 500];
    }

    public function getBlocks($sectionId = null) {
        if ($sectionId) {
            return $this->blockModel->findBySection($sectionId);
        }
        return [];
    }

    public function getBlock($id) {
        $block = $this->blockModel->findById($id);
        return $block ?: ['error' => 'Block not found', 'code' => 404];
    }

    public function createBlock($data) {
        if (empty($data['section_id']) || empty($data['block_name'])) {
            return ['error' => 'Section ID and block name are required', 'code' => 400];
        }
        $result = $this->blockModel->create($data);
        if ($result) {
            $this->sectionModel->updateCounts($data['section_id']);
            return ['success' => true, 'message' => 'Block created'];
        }
        return ['error' => 'Failed to create block', 'code' => 500];
    }

    public function updateBlock($id, $data) {
        if (empty($data['block_name'])) {
            return ['error' => 'Block name is required', 'code' => 400];
        }
        $block = $this->blockModel->findById($id);
        $result = $this->blockModel->update($id, $data);
        if ($result && $block) {
            $this->sectionModel->updateCounts($block['section_id']);
            return ['success' => true, 'message' => 'Block updated'];
        }
        return ['error' => 'Failed to update block', 'code' => 500];
    }

    public function deleteBlock($id) {
        $block = $this->blockModel->findById($id);
        $result = $this->blockModel->delete($id);
        if ($result && $block) {
            $this->sectionModel->updateCounts($block['section_id']);
            return ['success' => true, 'message' => 'Block deleted'];
        }
        return ['error' => 'Failed to delete block', 'code' => 500];
    }

    public function getLots($filters = [], $pagination = []) {
        $page = !empty($pagination['page']) ? (int) $pagination['page'] : null;
        $perPage = !empty($pagination['per_page']) ? (int) $pagination['per_page'] : null;

        if ($page === null && $perPage === null) {
            return $this->lotModel->findAll($filters);
        }

        $page = max(1, $page ?: 1);
        $perPage = max(1, min(100, $perPage ?: 10));
        $total = $this->lotModel->countAll($filters);
        $data = $this->lotModel->findAll($filters, ['page' => $page, 'per_page' => $perPage]);

        return [
            'data' => $data,
            'meta' => [
                'page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'total_pages' => (int) ceil($total / $perPage),
            ],
        ];
    }

    public function getLot($id) {
        $lot = $this->lotModel->findById($id);
        return $lot ?: ['error' => 'Lot not found', 'code' => 404];
    }

    public function createLot($data) {
        $required = ['block_id', 'lot_number', 'lot_type_id', 'price'];
        foreach ($required as $field) {
            if (!array_key_exists($field, $data) || $data[$field] === '' || $data[$field] === null) {
                return ['error' => "Field '$field' is required", 'code' => 400];
            }
        }

        $data['block_id'] = (int) $data['block_id'];
        $data['lot_type_id'] = (int) $data['lot_type_id'];
        $data['price'] = (float) $data['price'];

        $result = $this->lotModel->create($data);
        if ($result) {
            $block = $this->blockModel->findById($data['block_id']);
            if ($block) {
                $this->sectionModel->updateCounts($block['section_id']);
            }
            return ['success' => true, 'message' => 'Lot created'];
        }
        return ['error' => 'Failed to create lot', 'code' => 500];
    }

    public function updateLot($id, $data) {
        if (empty($data['lot_number']) || empty($data['lot_type_id'])) {
            return ['error' => 'Lot number and type are required', 'code' => 400];
        }

        $data['block_id'] = isset($data['block_id']) ? (int) $data['block_id'] : null;
        $data['lot_type_id'] = (int) $data['lot_type_id'];
        $data['price'] = (float) $data['price'];

        $oldLot = $this->lotModel->findById($id);
        $result = $this->lotModel->update($id, $data);
        if ($result && $oldLot) {
            if (isset($data['block_id']) && $data['block_id'] != $oldLot['block_id']) {
                $this->sectionModel->updateCounts($oldLot['block_id']);
                $this->sectionModel->updateCounts($data['block_id']);
            }
            return ['success' => true, 'message' => 'Lot updated'];
        }
        return ['error' => 'Failed to update lot', 'code' => 500];
    }

    public function deleteLot($id) {
        $lot = $this->lotModel->findById($id);
        $result = $this->lotModel->delete($id);
        if ($result && $lot) {
            $block = $this->blockModel->findById($lot['block_id']);
            if ($block) {
                $this->sectionModel->updateCounts($block['section_id']);
            }
            return ['success' => true, 'message' => 'Lot deleted'];
        }
        return ['error' => 'Failed to delete lot', 'code' => 500];
    }

    public function getStats() {
        return $this->lotModel->getStats();
    }

    public function getLotTypes() {
        return $this->lotModel->getLotTypes();
    }

    public function getCategories() {
        return $this->lotModel->findCategories();
    }

    public function createCategory($data) {
        if (empty($data['type_name'])) {
            return ['error' => 'Category name is required', 'code' => 400];
        }
        $result = $this->lotModel->createCategory($data);
        return $result ? ['success' => true, 'message' => 'Category created'] : ['error' => 'Failed to create category', 'code' => 500];
    }

    public function updateCategory($id, $data) {
        if (empty($data['type_name'])) {
            return ['error' => 'Category name is required', 'code' => 400];
        }
        $result = $this->lotModel->updateCategory($id, $data);
        return $result ? ['success' => true, 'message' => 'Category updated'] : ['error' => 'Failed to update category', 'code' => 500];
    }

    public function deleteCategory($id) {
        $result = $this->lotModel->deleteCategory($id);
        return $result ? ['success' => true, 'message' => 'Category deleted'] : ['error' => 'Failed to delete category', 'code' => 500];
    }
}
